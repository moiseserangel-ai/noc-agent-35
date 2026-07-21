import config from '../config/index.js';
import logger from '../utils/logger.js';
import prisma from '../database/client.js';
import { decrypt } from '../utils/crypto.js';
import { providerRunners } from '../ai/providers.js';

export async function getAiConfiguration() {
  const keys = ['ai_provider', 'ai_fallback_order', 'claude_api_key', 'claude_model', 'openai_api_key', 'openai_model', 'gemini_api_key', 'gemini_model'];
  const rows = await prisma.settings.findMany({ where: { key: { in: keys } } });
  const values = Object.fromEntries(rows.map(r => [r.key, r.encrypted ? decrypt(r.value) : r.value]));
  return {
    primary: values.ai_provider || 'claude',
    fallback: (values.ai_fallback_order || '').split(',').map(v => v.trim()).filter(Boolean),
    providers: {
      claude: { apiKey: values.claude_api_key || config.claude.apiKey, model: values.claude_model || config.claude.model },
      openai: { apiKey: values.openai_api_key || '', model: values.openai_model || 'gpt-5.6' },
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
    const cfg = await getAiConfiguration();
    const order = [...new Set([cfg.primary, ...cfg.fallback])].filter(p => providerRunners[p] && cfg.providers[p]?.apiKey);
    if (!order.length) throw new Error('Nenhum provedor de IA possui API key configurada');
    let lastError;
    for (const provider of order) {
      try {
        logger.info(`[${this.name}] provider=${provider} model=${cfg.providers[provider].model}`);
        const result = await providerRunners[provider]({ ...cfg.providers[provider], systemPrompt: this.systemPrompt, tools: this.tools, message: userMessage, executeTool: this.executeToolCall.bind(this), onEvent });
        return { ...result, provider };
      } catch (err) { lastError = err; logger.error(`[${this.name}] ${provider} falhou: ${err.message}`); }
    }
    throw lastError || new Error('Falha em todos os provedores');
  }
  async runStreaming(userMessage, onChunk) {
    const result = await this.run(userMessage, {}, onChunk);
    if (result.text) onChunk?.({ type: 'text', text: result.text });
    return result;
  }
}
