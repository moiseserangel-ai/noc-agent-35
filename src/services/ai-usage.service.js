import prisma from '../database/client.js';

const PRICE_PER_MILLION = {
  claude: { input: 3, output: 15 },
  openai: { input: 1.25, output: 10 },
  gemini: { input: 0.30, output: 2.50 },
};

const compact = value => String(value || '').replace(/\s+/g, ' ').slice(0, 500);

export function normalizeUsage(provider, usage = {}) {
  const inputTokens = Number(usage.input_tokens ?? usage.inputTokens ?? usage.promptTokenCount ?? 0) || 0;
  const outputTokens = Number(usage.output_tokens ?? usage.outputTokens ?? usage.candidatesTokenCount ?? 0) || 0;
  const totalTokens = Number(usage.total_tokens ?? usage.totalTokens ?? usage.totalTokenCount ?? inputTokens + outputTokens) || inputTokens + outputTokens;
  const price = PRICE_PER_MILLION[provider];
  const estimatedCost = price ? (inputTokens * price.input + outputTokens * price.output) / 1_000_000 : null;
  return { inputTokens, outputTokens, totalTokens, estimatedCost };
}

export function classifyAiError(error) {
  const status = Number(error?.status || error?.statusCode || 0);
  const message = compact(error?.message).toLowerCase();
  const retryAfterHeader = error?.retryAfter || error?.headers?.get?.('retry-after') || error?.headers?.['retry-after'];
  const retryAfter = Math.max(0, Number(retryAfterHeader) || 0);
  if (status === 429 || /rate.?limit|too many requests/.test(message)) {
    const quota = /quota|billing|credit|limit:\s*0|exceeded your current quota/.test(message);
    return { kind: quota ? 'quota' : 'rate_limit', retryAfterSeconds: retryAfter || (quota ? 3600 : 60) };
  }
  if (status === 401 || status === 403 || /api key|unauthorized|permission/.test(message)) return { kind: 'auth', retryAfterSeconds: 900 };
  if (status === 404 || /model.*not found|model.*no longer/.test(message)) return { kind: 'model', retryAfterSeconds: 900 };
  if (status >= 500) return { kind: 'provider', retryAfterSeconds: 60 };
  return { kind: 'unknown', retryAfterSeconds: 30 };
}

export async function providerAvailability(provider) {
  const state = await prisma.aiProviderState.findUnique({ where: { provider } });
  if (!state?.cooldownUntil || state.cooldownUntil <= new Date()) return { available: true, state };
  return { available: false, state };
}

export async function recordAiSuccess({ provider, model, agentName, usage, durationMs }) {
  const tokens = normalizeUsage(provider, usage);
  await prisma.$transaction([
    prisma.aiUsageLog.create({ data: { provider, model, agentName, status: 'success', durationMs, ...tokens } }),
    prisma.aiProviderState.upsert({
      where: { provider },
      create: { provider, status: 'available', lastSuccessAt: new Date() },
      update: { status: 'available', reason: null, cooldownUntil: null, consecutiveErrors: 0, lastSuccessAt: new Date() },
    }),
  ]);
}

export async function recordAiFailure({ provider, model, agentName, error, durationMs }) {
  const { kind, retryAfterSeconds } = classifyAiError(error);
  const cooldownUntil = new Date(Date.now() + retryAfterSeconds * 1000);
  const stateStatus = kind === 'quota' ? 'quota_exhausted' : 'cooldown';
  await prisma.$transaction([
    prisma.aiUsageLog.create({ data: { provider, model, agentName, status: 'error', errorKind: kind, errorMessage: compact(error?.message), durationMs } }),
    prisma.aiProviderState.upsert({
      where: { provider },
      create: { provider, status: stateStatus, reason: compact(error?.message), cooldownUntil, consecutiveErrors: 1, lastErrorAt: new Date() },
      update: { status: stateStatus, reason: compact(error?.message), cooldownUntil, consecutiveErrors: { increment: 1 }, lastErrorAt: new Date() },
    }),
  ]);
  return { kind, cooldownUntil };
}

export async function recordAiSkipped({ provider, model, agentName, reason }) {
  await prisma.aiUsageLog.create({ data: { provider, model, agentName, status: 'skipped', errorKind: 'cooldown', errorMessage: compact(reason) } });
}

const periodStart = query => {
  const days = Math.min(365, Math.max(1, Number(query.days) || 30));
  return new Date(Date.now() - days * 86400000);
};

export async function buildAiUsageReport(query = {}) {
  const from = periodStart(query);
  const [logs, states,feedbackMessages] = await Promise.all([
    prisma.aiUsageLog.findMany({ where: { createdAt: { gte: from } }, orderBy: { createdAt: 'desc' }, take: 10000 }),
    prisma.aiProviderState.findMany({ orderBy: { provider: 'asc' } }),
    prisma.chatMessage.findMany({where:{role:'assistant',createdAt:{gte:from}},select:{id:true,agentUsed:true,provider:true,model:true,feedback:true,createdAt:true,session:{select:{id:true,title:true}}},orderBy:{createdAt:'desc'},take:10000}),
  ]);
  const providers = ['claude', 'openai', 'gemini'].map(provider => {
    const rows = logs.filter(log => log.provider === provider);
    const successes = rows.filter(log => log.status === 'success');
    const errors = rows.filter(log => log.status === 'error');
    const state = states.find(item => item.provider === provider);
    const cooling = state?.cooldownUntil && state.cooldownUntil > new Date();
    return {
      provider,
      status: cooling ? state.status : 'available',
      reason: cooling ? state.reason : null,
      cooldownUntil: cooling ? state.cooldownUntil : null,
      requests: successes.length,
      errors: errors.length,
      skipped: rows.filter(log => log.status === 'skipped').length,
      inputTokens: successes.reduce((sum, row) => sum + row.inputTokens, 0),
      outputTokens: successes.reduce((sum, row) => sum + row.outputTokens, 0),
      totalTokens: successes.reduce((sum, row) => sum + row.totalTokens, 0),
      estimatedCost: successes.reduce((sum, row) => sum + (row.estimatedCost || 0), 0),
      lastSuccessAt: state?.lastSuccessAt || null,
      lastErrorAt: state?.lastErrorAt || null,
    };
  });
  const qualityGroup=(keyOf)=>{
    const keys=new Set([...feedbackMessages.map(keyOf),...logs.map(keyOf)].filter(Boolean));
    return [...keys].map(key=>{const messages=feedbackMessages.filter(row=>keyOf(row)===key),calls=logs.filter(row=>keyOf(row)===key),rated=messages.filter(row=>row.feedback),positive=messages.filter(row=>row.feedback==='positive').length,successes=calls.filter(row=>row.status==='success'),errors=calls.filter(row=>row.status==='error');return{key,responses:messages.length,rated:rated.length,positive,negative:messages.filter(row=>row.feedback==='negative').length,satisfaction:rated.length?Math.round(positive/rated.length*100):null,calls:successes.length,errors:errors.length,successRate:successes.length+errors.length?Math.round(successes.length/(successes.length+errors.length)*100):null,averageDurationMs:successes.length?Math.round(successes.reduce((sum,row)=>sum+(row.durationMs||0),0)/successes.length):null,totalTokens:successes.reduce((sum,row)=>sum+row.totalTokens,0)};}).sort((a,b)=>(b.responses+b.calls)-(a.responses+a.calls)||a.key.localeCompare(b.key));
  };
  const rated=feedbackMessages.filter(row=>row.feedback),positive=rated.filter(row=>row.feedback==='positive').length,totalFinished=logs.filter(row=>['success','error'].includes(row.status));
  const quality={summary:{responses:feedbackMessages.length,rated:rated.length,unrated:feedbackMessages.length-rated.length,positive,negative:rated.length-positive,satisfaction:rated.length?Math.round(positive/rated.length*100):null,feedbackCoverage:feedbackMessages.length?Math.round(rated.length/feedbackMessages.length*100):0,apiSuccessRate:totalFinished.length?Math.round(totalFinished.filter(row=>row.status==='success').length/totalFinished.length*100):null},byAgent:qualityGroup(row=>row.agentUsed||row.agentName||'não identificado'),byModel:qualityGroup(row=>row.provider&&row.model?`${row.provider} · ${row.model}`:null),recentNegative:feedbackMessages.filter(row=>row.feedback==='negative').slice(0,20)};
  return {
    from,
    summary: {
      requests: providers.reduce((sum, item) => sum + item.requests, 0),
      errors: providers.reduce((sum, item) => sum + item.errors, 0),
      totalTokens: providers.reduce((sum, item) => sum + item.totalTokens, 0),
      estimatedCost: providers.reduce((sum, item) => sum + item.estimatedCost, 0),
    },
    providers,
    recent: logs.slice(0, 100),
    quality,
    pricingNote: 'Custos são estimativas de referência e podem diferir da cobrança real do modelo/contrato.',
  };
}

export async function clearProviderCooldown(provider) {
  return prisma.aiProviderState.upsert({
    where: { provider }, create: { provider },
    update: { status: 'available', reason: null, cooldownUntil: null, consecutiveErrors: 0 },
  });
}
