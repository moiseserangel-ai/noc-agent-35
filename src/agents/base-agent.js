import config from '../config/index.js';
import logger from '../utils/logger.js';
import prisma from '../database/client.js';
import { decrypt } from '../utils/crypto.js';
import { providerRunners } from '../ai/providers.js';
import { providerAvailability, recordAiFailure, recordAiSkipped, recordAiSuccess } from '../services/ai-usage.service.js';
import { knowledgeContext } from '../services/knowledge.service.js';

const CONFIGURATION_REQUEST = /\b(configur|alter|cria|adicion|remov|exclu|desativ|ativ|bloque|liber|aplic|reinici|instal|atualiz|migr)\w*/i;
const APPROVED_EXECUTION = /(?:solu[cç][aã]o|mudan[cç]a)\s+aprovad[ao]/i;
const CRITICAL_REQUEST = /\b(?:cr[ií]tic|disaster|produ[cç][aã]o|indispon[ií]vel|queda|derrub|urgente|firewall|rota padr[aã]o|bgp|ospf|vpn)\w*/i;
const PREFLIGHT_COMMANDS = {
  mikrotik: ['/system resource print without-paging', '/system routerboard print without-paging', '/interface print detail without-paging', '/ip route print detail without-paging'],
  huawei_vrp: ['display version', 'display device', 'display interface brief', 'display ip routing-table'],
  cisco_ios: ['show version', 'show inventory', 'show interfaces status', 'show ip route'],
  fortigate_fortios: ['get system status', 'get system performance status', 'diagnose netlink interface list', 'get router info routing-table all'],
  linux: ['uname -a', 'cat /etc/os-release', 'ip addr show', 'ip route show', 'df -h'],
  juniper_junos: ['show version', 'show chassis hardware', 'show interfaces terse', 'show route summary'],
  ubiquiti_edgeos: ['show version', 'show interfaces', 'show ip route'],
  datacom_dmos: ['show version', 'show interfaces', 'show ip route'],
  nokia_sros: ['show version', 'show chassis', 'show port', 'show router route-table'],
};

function knowledgeInstruction(message) {
  if (!CONFIGURATION_REQUEST.test(String(message))) return '';
  return '\n\n[POLÍTICA DE CONFIGURAÇÃO]\nAntes de propor ou aplicar qualquer alteração, consulte a base de conhecimento do especialista para confirmar sintaxe, compatibilidade e procedimento. Use a documentação como referência técnica e cite a fonte quando ela influenciar a solução. Se não houver documentação relevante, informe isso claramente e não invente uma referência.';
}

function precisionInstruction(message) {
  if (!CONFIGURATION_REQUEST.test(String(message))) return '';
  return '\n\n[PADRÃO DE PRECISÃO OBRIGATÓRIO]\nAntes de escolher sintaxe, confirme no equipamento a versão, modelo, modo operacional e estado atual usando comandos somente leitura. Não presuma nomes de interfaces, VLANs, endereços ou recursos. A resposta deve conter exatamente as seções: 1) Evidências coletadas; 2) Diagnóstico; 3) Plano; 4) Comandos (sem executar nesta fase); 5) Risco/impacto; 6) Validação pós-mudança; 7) Rollback. Se a versão ou evidência necessária não estiver disponível, pare e solicite a coleta em vez de inventar valores.';
}

function approvedExecutionInstruction(message) {
  if (!APPROVED_EXECUTION.test(String(message))) return '';
  return '\n\n[EXECUÇÃO APROVADA — PLANO IMUTÁVEL]\nA proposta delimitada como solução/mudança aprovada foi revisada e autorizada pelo administrador. Execute somente o que está explicitamente descrito nesse plano, sem adicionar, remover, substituir ou redesenhar etapas. Não transforme a execução em um novo diagnóstico nem escolha uma solução alternativa. Preserve os parâmetros, objetos, comentários e comandos aprovados. Se o plano estiver incompleto, incompatível com o estado atual ou não puder ser executado exatamente, pare antes de alterar o equipamento e informe a divergência para nova aprovação. Após cada comando, valide o resultado e reporte fielmente o que foi executado.';
}

export async function getAiConfiguration() {
  const keys = ['ai_provider', 'ai_fallback_order', 'ai_simple_provider', 'ai_diagnostic_provider', 'ai_critical_provider', 'claude_api_key', 'claude_model', 'openai_api_key', 'openai_model', 'gemini_api_key', 'gemini_model'];
  const rows = await prisma.settings.findMany({ where: { key: { in: keys } } });
  const values = Object.fromEntries(rows.map(r => [r.key, r.encrypted ? decrypt(r.value) : r.value]));
  return {
    primary: values.ai_provider || 'claude',
    routing: { simple: values.ai_simple_provider || values.ai_provider || 'openai', diagnostic: values.ai_diagnostic_provider || values.ai_provider || 'openai', critical: values.ai_critical_provider || 'claude' },
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
  async collectPreflight(deviceId) {
    const commands = PREFLIGHT_COMMANDS[this.name];
    const ssh = Object.entries(this.toolHandlers).find(([name]) => /^ssh/i.test(name))?.[1];
    if (!commands || !ssh) return '';
    const rows = [];
    for (const command of commands) {
      try { const result = await ssh({ deviceId, command }); rows.push(`$ ${command}\n${String(result?.output || '').slice(0, 4000)}`); }
      catch (error) { rows.push(`$ ${command}\nErro na coleta: ${error.message}`); }
    }
    return rows.join('\n\n');
  }
  async executeToolCall(name, input) {
    const handler = this.toolHandlers[name];
    if (!handler) return JSON.stringify({ error: `Unknown tool: ${name}` });
    try { return JSON.stringify(await handler(input)); } catch (err) { logger.error(`Tool ${name}: ${err.message}`); return JSON.stringify({ error: err.message }); }
  }
  async run(userMessage, _context = {}, onEvent) {
    let tenantId = _context.tenantId;
    const deviceId = _context.deviceId || String(userMessage).match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i)?.[0];
    const deviceContext = deviceId ? await prisma.device.findUnique({ where: { id: deviceId }, select: { tenantId: true, type: true, manufacturer: true, model: true, platform: true, osVersion: true, capabilities: true } }) : null;
    if (tenantId === undefined) tenantId = deviceContext?.tenantId ?? null;
    const preflightEvidence = deviceId && !APPROVED_EXECUTION.test(String(userMessage)) ? await this.collectPreflight(deviceId) : '';
    const preflightInstruction = preflightEvidence ? `\n\n[EVIDÊNCIAS PRÉVIAS COLETADAS AUTOMATICAMENTE — somente leitura]\n${preflightEvidence}` : '';
    const mikrotikModel = String(deviceContext?.model || '');
    const mikrotikRole = deviceContext?.type === 'mikrotik' ? (/\b(?:CRS|CSS)/i.test(mikrotikModel) ? 'switch' : 'router') : '';
    const routerOsMajor = deviceContext?.type === 'mikrotik' ? (String(deviceContext.osVersion || '').match(/^([67])/)?.[1] || preflightEvidence.match(/\bversion:\s*([67])(?:\.|\b)/i)?.[1] || '') : '';
    const knowledgeClassification = mikrotikRole ? `MikroTik ${mikrotikRole} ${routerOsMajor ? `RouterOS ${routerOsMajor}` : ''}` : '';
    const knowledgeQuery = `${userMessage} ${knowledgeClassification}`.trim();
    const classificationInstruction = knowledgeClassification ? `\n\n[CLASSIFICAÇÃO AUTOMÁTICA PARA DOCUMENTAÇÃO]\n${knowledgeClassification}` : '';
    const knowledgeBlock=await knowledgeContext(knowledgeQuery, this.name, tenantId);
    const knowledgeSources=[...knowledgeBlock.matchAll(/\[FONTE \d+: ([^>\]]+)/g)].map(match=>match[1].trim());
    const contextualMessage = `${approvedExecutionInstruction(userMessage)}${userMessage}${classificationInstruction}${preflightInstruction}${precisionInstruction(userMessage)}${knowledgeInstruction(userMessage)}${knowledgeBlock}`;
    const cfg = await getAiConfiguration();
    const risk = CRITICAL_REQUEST.test(String(userMessage)) ? 'critical' : CONFIGURATION_REQUEST.test(String(userMessage)) ? 'diagnostic' : 'simple';
    const selectedPrimary = cfg.routing[risk] || cfg.primary;
    const order = [...new Set([selectedPrimary, cfg.primary, ...cfg.fallback])].filter(p => providerRunners[p] && cfg.providers[p]?.apiKey);
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
        return { ...result, provider, model: cfg.providers[provider].model, knowledgeSources };
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
