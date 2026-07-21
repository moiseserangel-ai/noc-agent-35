import config from '../config/index.js';
import logger from '../utils/logger.js';
import prisma from '../database/client.js';
import { decrypt } from '../utils/crypto.js';

export async function getEvolutionConfig() {
  try {
    const settings = await prisma.settings.findMany({
      where: {
        key: { in: ['evolution_api_url', 'evolution_api_key', 'evolution_instance', 'admin_whatsapp', 'authorized_numbers'] }
      }
    });
    
    const dbConfig = {};
    for (const s of settings) {
      dbConfig[s.key] = s.encrypted ? decrypt(s.value) : s.value;
    }
    
    return {
      apiUrl: dbConfig['evolution_api_url'] || config.evolution.apiUrl,
      apiKey: dbConfig['evolution_api_key'] || config.evolution.apiKey,
      instance: dbConfig['evolution_instance'] || config.evolution.instance,
      adminWhatsapp: dbConfig['admin_whatsapp'] || config.evolution.adminWhatsapp,
      authorizedNumbers: dbConfig['authorized_numbers'] 
        ? dbConfig['authorized_numbers'].split(',').map(n => n.trim()).filter(Boolean) 
        : config.authorizedNumbers
    };
  } catch (err) {
    logger.error(`Error loading Evolution config: ${err.message}`);
    return config.evolution;
  }
}

export async function sendWhatsAppMessage(number, text) {
  const evoConfig = await getEvolutionConfig();
  if (!evoConfig.apiUrl || !evoConfig.instance) {
    throw new Error('Evolution API URL or Instance not configured');
  }

  const cleanUrl = evoConfig.apiUrl.endsWith('/') ? evoConfig.apiUrl.slice(0, -1) : evoConfig.apiUrl;
  const url = `${cleanUrl}/message/sendText/${evoConfig.instance}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: evoConfig.apiKey || '',
      },
      body: JSON.stringify({ number, text }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(`Evolution API error: ${JSON.stringify(data)}`);
    }

    logger.info(`WhatsApp message sent to ${number}`);
    return data;
  } catch (err) {
    logger.error(`Failed to send WhatsApp message: ${err.message}`);
    throw err;
  }
}

export async function sendToAdmin(text) {
  const evoConfig = await getEvolutionConfig();
  if (!evoConfig.adminWhatsapp) {
    logger.warn('ADMIN_WHATSAPP not configured, skipping message');
    return null;
  }
  return sendWhatsAppMessage(evoConfig.adminWhatsapp, text);
}

export function parseIncomingMessage(webhookData) {
  try {
    const data = webhookData?.data;
    if (!data) return null;

    const message = data.message;
    if (!message) return null;

    const text = message.conversation ||
      message.extendedTextMessage?.text ||
      '';

    const from = data.key?.remoteJid?.replace('@s.whatsapp.net', '') || '';
    const isFromMe = data.key?.fromMe || false;

    return {
      from,
      text: text.trim(),
      isFromMe,
      messageId: data.key?.id || '',
      timestamp: data.messageTimestamp || Date.now(),
    };
  } catch (err) {
    logger.error(`Error parsing incoming message: ${err.message}`);
    return null;
  }
}

export async function isAuthorizedNumber(number) {
  const evoConfig = await getEvolutionConfig();
  if (!evoConfig.authorizedNumbers || evoConfig.authorizedNumbers.length === 0) return false;
  const normalized = String(number).replace(/\D/g, '');
  return evoConfig.authorizedNumbers.some(n => String(n).replace(/\D/g, '') === normalized);
}
