import BaseAgent from './base-agent.js';
import prisma from '../database/client.js';
import logger from '../utils/logger.js';

const SYSTEM_PROMPT = `Você é o Agent de Suporte NOC (Network Operations Center). Sua função principal é:

1. **Receber e classificar** mensagens de WhatsApp ou alertas do Zabbix
2. **Identificar o dispositivo** mencionado na mensagem (pelo nome, IP ou hostname)
3. **Determinar o tipo** do dispositivo (MikroTik ou Linux)
4. **Processar aprovações** de tasks (quando a mensagem contém #TASK-XXX com SIM ou NÃO)

## Regras:
- Responda SEMPRE em português brasileiro
- Seja direto e objetivo
- OBRIGATÓRIO: Antes de retornar a classificação, você DEVE usar a tool "search_device" passando o nome ou IP que o usuário mencionou para encontrar o ID real do dispositivo no banco de dados. NUNCA adivinhe ou invente o ID.
- Se a tool "search_device" não encontrar o dispositivo, retorne action "unknown" informando que o dispositivo não foi encontrado no banco de dados.
- Use a tool "list_devices" caso precise ver todos os dispositivos disponíveis.
- Considere o histórico da conversa. Quando o usuário disser "esse equipamento", "nele", "a mesma RB" ou fizer uma pergunta de continuação, reutilize o último dispositivo claramente identificado na sessão.
- Mesmo ao reutilizar o dispositivo do histórico, confirme o ID real chamando "search_device" com o nome ou IP conhecido.
- Só peça novamente o nome do equipamento quando não existir um dispositivo inequívoco no histórico ou quando houver mais de uma possibilidade.

## Formato de resposta para classificação:
Quando identificar um dispositivo, responda EXATAMENTE neste formato JSON:
{
  "action": "route_to_specialist",
  "deviceId": "<id-do-dispositivo>",
  "deviceType": "mikrotik" ou "linux",
  "deviceName": "<nome-do-dispositivo>",
  "originalRequest": "<o que foi pedido>",
  "priority": "low|medium|high|critical"
}

## Para aprovação de task:
Se a mensagem contém referência a #TASK-XXX com SIM/NÃO:
{
  "action": "task_approval",
  "taskNumber": <número>,
  "approved": true/false
}

## Para mensagem não identificada:
{
  "action": "unknown",
  "message": "<mensagem de erro ou pedido de informação>"
}`;

export default class SupportAgent extends BaseAgent {
  constructor() {
    super('support', SYSTEM_PROMPT);

    this.registerTool(
      {
        name: 'list_devices',
        description: 'Lista todos os dispositivos cadastrados no sistema com seus nomes, IPs, tipos e status.',
        input_schema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      async () => {
        const devices = await prisma.device.findMany({
          where: { isActive: true },
          select: { id: true, name: true, hostname: true, type: true, group: true, zabbixHostId: true },
        });
        return { devices, total: devices.length };
      }
    );

    this.registerTool(
      {
        name: 'search_device',
        description: 'Busca um dispositivo pelo nome, hostname/IP ou ID do Zabbix.',
        input_schema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Nome, hostname, IP ou zabbixHostId para buscar',
            },
          },
          required: ['query'],
        },
      },
      async ({ query }) => {
        const q = query.toLowerCase();
        const devices = await prisma.device.findMany({ where: { isActive: true } });
        const found = devices.filter(
          d =>
            d.name.toLowerCase().includes(q) ||
            d.hostname.toLowerCase().includes(q) ||
            (d.zabbixHostId && d.zabbixHostId.toLowerCase().includes(q))
        );
        return found.length > 0
          ? { found: true, devices: found.map(d => ({ id: d.id, name: d.name, hostname: d.hostname, type: d.type })) }
          : { found: false, message: `Nenhum dispositivo encontrado para "${query}"` };
      }
    );
  }

  async classify(message, source = 'whatsapp') {
    try {
      const result = await this.run(
        `Classifique esta mensagem recebida via ${source}:\n\n"${message}"\n\nRetorne APENAS o JSON de classificação, sem texto adicional.`
      );

      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        logger.warn(`[support] Could not parse classification JSON from: ${result.text}`);
        return { action: 'unknown', message: result.text };
      }

      return JSON.parse(jsonMatch[0]);
    } catch (err) {
      logger.error(`[support] Classification error: ${err.message}`);
      return { action: 'error', message: `Erro ao classificar: ${err.message}` };
    }
  }
}
