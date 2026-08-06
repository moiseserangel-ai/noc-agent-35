import config from '../config/index.js';
import logger from '../utils/logger.js';
import prisma from '../database/client.js';
import { decrypt } from '../utils/crypto.js';
import { providerRunners } from '../ai/providers.js';
import { providerAvailability, recordAiFailure, recordAiSkipped, recordAiSuccess } from '../services/ai-usage.service.js';
import { knowledgeContext } from '../services/knowledge.service.js';

const CONFIGURATION_REQUEST = /\b(configur|alter|cria|adicion|remov|exclu|desativ|ativ|bloque|liber|aplic|reinici|instal|atualiz|migr)\w*/i;

function knowledgeInstruction(message) {
  if (!CONFIGURATION_REQUEST.test(String(message))) return '';
  return '\n\n[POLÍTICA DE CONFIGURAÇÃO]\nAntes de propor ou aplicar qualquer alteração, consulte a base de conhecimento do especialista para confirmar sintaxe, compatibilidade e procedimento. Use a documentação como referência técnica e cite a fonte quando ela influenciar a solução. Se não houver documentação relevante, informe isso claramente e não invente uma referência.';
}

export async function getAiConfiguration() {
  const keys = ['ai_provider', 'ai_fallback_order', 'claude_api_key', 'claude_model', 'openai_api_key', 'openai_model', 'gemini_api_key', 'gemini_model'];
  const rows = await prisma.settings.findMany({ where: { key: { in: keys } } });
  const values = Object.fromEntries(rows.map(r => [r.key, r.encrypted ? decrypt(r.value) : r.value]));
  return {
    primary: values.ai_provider || 'claude',
    fallback: (values.ai_fallback_order || '').split(',').map(v => v.trim()).filter(Boolean),
    providers: {
      claude: { apiKey: values.claude_api_key || config.claude.apiKey, model: values.claude_model || config.claude.model },
      openai: { apiKey: values.openai_api_key || '', model: values.openai_model || 'gpt-5.6-sol' },
      gemini: { apiKey: values.gemini_api_key || '', model: values.gemini_model || 'gemini-3.5-flash' },
    },
  };
}

export default class BaseAgent {
  constructor(name, systemPrompt, tools = []) { this.name = name; this.systemPrompt = systemPrompt; this.tools = tools; this.toolHandlers = {}; }
  registerTool(definition, handler) { this.tools.push(definition); this.toolHandlers[definition.name] = handler; }
  async executeToolCall(name, input) {
    const handler = this.toolHandlers[name];
    if (!handler) return JSON.stringify({ error: `Unknown tool: ${name}` });
    try { return JSON.stringify(await handler(input)); } catch (err) { logger.error(`Tool ${name}: ${err.message}`); return JSON.stringify({ error: err.message }); }
  }
  async run(userMessage, _context = {}, onEvent) {
    let tenantId = _context.tenantId;
    if (tenantId === undefined) {
      const deviceId = String(userMessage).match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i)?.[0];
      if (deviceId) tenantId = (await prisma.device.findUnique({ where: { id: deviceId }, select: { tenantId: true } }))?.tenantId ?? null;
    }
    const contextualMessage = `${userMessage}${knowledgeInstruction(userMessage)}${await knowledgeContext(userMessage, this.name, tenantId)}`;
    const cfg = await getAiConfiguration();
    const order = [...new Set([cfg.primary, ...cfg.fallback])].filter(p => providerRunners[p] && cfg.providers[p]?.apiKey);
    if (!order.length) throw new Error('Nenhum provedor de IA possui API key configurada');
    let lastError;
    for (const provider of order) {
      const availability = await providerAvailability(provider);
      if (!availability.available) {
        const reason = `Indisponível até ${availability.state.cooldownUntil.toISOString()}: ${availability.state.reason || 'limite temporário'}`;
        await recordAiSkipped({ provider, model: cfg.providers[provider].model, agentName: this.name, reason });
        logger.warn(`[${this.name}] provider=${provider} ignorado: ${reason}`);
        continue;
      }
      const startedAt = Date.now();
      try {
        logger.info(`[${this.name}] provider=${provider} model=${cfg.providers[provider].model}`);
        const result = await providerRunners[provider]({ ...cfg.providers[provider], systemPrompt: this.systemPrompt, tools: this.tools, message: contextualMessage, history: _context.history || [], executeTool: this.executeToolCall.bind(this), onEvent });
        await recordAiSuccess({ provider, model: cfg.providers[provider].model, agentName: this.name, usage: result.usage, durationMs: Date.now() - startedAt });
        return { ...result, provider };
      } catch (err) {
        lastError = err;
        const failure = await recordAiFailure({ provider, model: cfg.providers[provider].model, agentName: this.name, error: err, durationMs: Date.now() - startedAt });
        logger.error(`[${this.name}] ${provider} falhou (${failure.kind}): ${err.message}`);
      }
    }
    throw lastError || new Error('Todos os provedores configurados estão temporariamente indisponíveis. Consulte Consumo de IA.');
  }
  async runStreaming(userMessage, onChunk, context = {}) {
    const result = await this.run(userMessage, context, onChunk);
    if (result.text) onChunk?.({ type: 'text', text: result.text });
    return result;
  }
}
