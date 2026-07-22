import { Router } from 'express';
import prisma from '../database/client.js';
import { encrypt, decrypt } from '../utils/crypto.js';
import Anthropic from '@anthropic-ai/sdk';
import logger from '../utils/logger.js';
import { providerRunners } from '../ai/providers.js';
import { getNotificationConfig, sendTelegramMessage } from '../services/notification.service.js';

const router = Router();

const SENSITIVE_KEYS = ['claude_api_key', 'openai_api_key', 'gemini_api_key', 'evolution_api_key', 'telegram_bot_token', 'zabbix_webhook_token', 'dashboard_password', 'encryption_key'];

router.post('/test-telegram', async (req, res) => {
  try {
    const cfg = await getNotificationConfig();
    const chatId = String(req.body.chatId || cfg.telegramChats[0] || '').trim();
    let token = req.body.token;
    if (!token || token === '••••••••') token = cfg.telegramToken;
    await sendTelegramMessage(chatId, '✅ Teste do NOC Agent: integração com Telegram funcionando.', token);
    res.json({ success: true });
  } catch (error) { res.status(400).json({ success: false, error: error.message }); }
});

router.get('/', async (req, res, next) => {
  try {
    const settings = await prisma.settings.findMany();
    const safe = settings.map(s => ({
      ...s,
      value: s.encrypted ? '••••••••' : s.value,
    }));
    res.json({ success: true, data: safe });
  } catch (err) { next(err); }
});

router.get('/:key', async (req, res, next) => {
  try {
    const setting = await prisma.settings.findUnique({ where: { key: req.params.key } });
    if (!setting) return res.status(404).json({ success: false, error: 'Setting not found' });
    res.json({
      success: true,
      data: { ...setting, value: setting.encrypted ? '••••••••' : setting.value },
    });
  } catch (err) { next(err); }
});

router.put('/:key', async (req, res, next) => {
  try {
    const { value } = req.body;
    if (value === undefined || value === null) {
      return res.status(400).json({ success: false, error: 'Value is required' });
    }

    const isSensitive = SENSITIVE_KEYS.includes(req.params.key);
    const storeValue = isSensitive ? encrypt(value) : value;

    const setting = await prisma.settings.upsert({
      where: { key: req.params.key },
      update: { value: storeValue, encrypted: isSensitive },
      create: { key: req.params.key, value: storeValue, encrypted: isSensitive },
    });

    res.json({
      success: true,
      data: { ...setting, value: isSensitive ? '••••••••' : setting.value },
    });
  } catch (err) { next(err); }
});

router.post('/bulk', async (req, res, next) => {
  try {
    const { settings } = req.body;
    if (!settings || !Array.isArray(settings)) {
      return res.status(400).json({ success: false, error: 'Settings array required' });
    }

    const results = [];
    for (const { key, value } of settings) {
      if (!key || value === undefined || value === '••••••••') continue;
      const isSensitive = SENSITIVE_KEYS.includes(key);
      const storeValue = isSensitive ? encrypt(value) : value;

      const setting = await prisma.settings.upsert({
        where: { key },
        update: { value: storeValue, encrypted: isSensitive },
        create: { key, value: storeValue, encrypted: isSensitive },
      });
      results.push({ key, saved: true });
    }

    res.json({ success: true, data: results });
  } catch (err) { next(err); }
});

router.post('/test-claude', async (req, res, next) => {
  try {
    let { apiKey, model } = req.body;
    
    logger.info(`[Claude Test] Iniciando teste de conexão para o modelo: ${model}`);

    if (!apiKey || apiKey === '••••••••') {
      const setting = await prisma.settings.findUnique({ where: { key: 'claude_api_key' } });
      if (!setting || !setting.value) {
        logger.error('[Claude Test] API Key não encontrada no banco de dados');
        return res.status(400).json({ success: false, error: 'API Key não configurada' });
      }
      apiKey = setting.encrypted ? decrypt(setting.value) : setting.value;
    }

    if (!model) {
      model = 'claude-3-5-sonnet-20241022';
    }

    const client = new Anthropic({ apiKey });
    
    logger.info(`[Claude Test] Enviando requisição de teste para a Anthropic API...`);
    const response = await client.messages.create({
      model: model,
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Responda apenas com a palavra OK' }]
    });

    logger.info(`[Claude Test] Conexão bem-sucedida! Resposta recebida: ${response.content[0].text}`);
    res.json({ success: true, message: 'Conexão com a API Claude estabelecida com sucesso!' });
  } catch (err) { 
    logger.error(`[Claude Test] Falha na conexão: ${err.message}`);
    res.json({ success: false, error: err.message });
  }
});

router.post('/test-ai', async (req, res) => {
  try {
    const { provider } = req.body;
    const defaultModels = { openai: 'gpt-5.6-terra', gemini: 'gemini-3.5-flash' };
    const model = String(req.body.model || defaultModels[provider] || '').trim();
    const keyName = `${provider}_api_key`;
    if (!providerRunners[provider] || !['openai', 'gemini'].includes(provider)) return res.status(400).json({ success: false, error: 'Provedor inválido' });
    if (!model || model === 'undefined') return res.status(400).json({ success: false, error: 'Modelo não configurado' });
    const setting = await prisma.settings.findUnique({ where: { key: keyName } });
    if (!setting?.value) return res.status(400).json({ success: false, error: 'Salve a API key primeiro' });
    const apiKey = setting.encrypted ? decrypt(setting.value) : setting.value;
    const result = await providerRunners[provider]({ apiKey, model, systemPrompt: 'Responda de forma concisa.', tools: [], message: 'Responda somente OK', executeTool: async () => '{}'});
    res.json({ success: true, message: result.text || 'OK' });
  } catch (err) { res.status(400).json({ success: false, error: err.message }); }
});

router.post('/gemini-models', async (req, res) => {
  try {
    let { apiKey } = req.body;
    if (!apiKey || apiKey === '••••••••') {
      const setting = await prisma.settings.findUnique({ where: { key: 'gemini_api_key' } });
      if (!setting?.value) return res.status(400).json({ success: false, error: 'Informe ou salve a API key do Gemini primeiro' });
      apiKey = setting.encrypted ? decrypt(setting.value) : setting.value;
    }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}&pageSize=1000`);
    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ success: false, error: data.error?.message || 'Não foi possível consultar os modelos do Gemini' });
    }

    const models = (data.models || [])
      .filter(model => model.supportedGenerationMethods?.includes('generateContent'))
      .map(model => ({
        id: model.name.replace(/^models\//, ''),
        name: model.displayName || model.name.replace(/^models\//, ''),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json({ success: true, data: models });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/test-evolution', async (req, res, next) => {
  try {
    let { apiUrl, apiKey, instance, phone } = req.body;
    
    logger.info(`[Evolution Test] Iniciando teste para: ${phone}`);

    if (!apiUrl || !instance || !phone) {
      return res.status(400).json({ success: false, error: 'URL, Instância e WhatsApp Admin são obrigatórios' });
    }

    if (!apiKey || apiKey === '••••••••') {
      const setting = await prisma.settings.findUnique({ where: { key: 'evolution_api_key' } });
      if (!setting || !setting.value) {
        return res.status(400).json({ success: false, error: 'API Key não configurada' });
      }
      apiKey = setting.encrypted ? decrypt(setting.value) : setting.value;
    }

    const formattedPhone = phone.replace(/\\D/g, '');
    const cleanUrl = apiUrl.endsWith('/') ? apiUrl.slice(0, -1) : apiUrl;
    const url = `${cleanUrl}/message/sendText/${instance}`;
    
    logger.info(`[Evolution Test] Enviando POST para ${url}`);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: apiKey,
      },
      body: JSON.stringify({ number: formattedPhone, text: '🤖 Olá! Esta é uma mensagem de teste do NOC Agent 35.' }),
    });

    const data = await response.json();

    if (!response.ok) {
      logger.error(`[Evolution Test] Erro: ${JSON.stringify(data)}`);
      return res.status(400).json({ success: false, error: data.message || JSON.stringify(data) });
    }

    logger.info(`[Evolution Test] Mensagem enviada com sucesso para ${formattedPhone}`);
    res.json({ success: true, message: 'Mensagem enviada com sucesso!' });
  } catch (err) { 
    logger.error(`[Evolution Test] Falha na conexão: ${err.message}`);
    res.json({ success: false, error: err.message });
  }
});

export default router;
