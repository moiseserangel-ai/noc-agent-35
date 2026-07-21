import 'dotenv/config';

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '127.0.0.1',
  nodeEnv: process.env.NODE_ENV || 'development',

  encryptionKey: process.env.ENCRYPTION_KEY || '',
  jwtSecret: process.env.JWT_SECRET || 'default-jwt-secret',
  dashboardPassword: process.env.DASHBOARD_PASSWORD || 'admin',
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean),
  evolutionWebhookToken: process.env.EVOLUTION_WEBHOOK_TOKEN || '',
  zabbixWebhookToken: process.env.ZABBIX_WEBHOOK_TOKEN || '',

  claude: {
    apiKey: process.env.CLAUDE_API_KEY || '',
    model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
  },

  evolution: {
    apiUrl: process.env.EVOLUTION_API_URL || 'http://localhost:8080',
    apiKey: process.env.EVOLUTION_API_KEY || '',
    instance: process.env.EVOLUTION_INSTANCE || 'noc-agent',
    adminWhatsapp: process.env.ADMIN_WHATSAPP || '',
  },

  zabbix: {
    webhookToken: process.env.ZABBIX_WEBHOOK_TOKEN || '',
    url: process.env.ZABBIX_URL || '',
  },

  authorizedNumbers: (process.env.AUTHORIZED_NUMBERS || '')
    .split(',')
    .map(n => n.trim())
    .filter(Boolean),
};

export default config;
