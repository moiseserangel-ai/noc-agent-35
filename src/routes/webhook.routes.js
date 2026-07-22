import { Router } from 'express';
import config from '../config/index.js';
import logger from '../utils/logger.js';
import SupportAgent from '../agents/support-agent.js';
import MikrotikAgent from '../agents/mikrotik-agent.js';
import LinuxAgent from '../agents/linux-agent.js';
import * as taskService from '../services/task.service.js';
import * as evolutionService from '../services/evolution.service.js';
import { parseZabbixAlert, formatAlertMessage } from '../services/zabbix.service.js';
import prisma from '../database/client.js';
import { getIncidentAutomationMode, shouldAutoDiagnoseIncident, describeIncidentPolicy } from '../services/incident-policy.service.js';
import { buildSlaFields } from '../services/sla.service.js';
import { notifyTask } from '../services/notification.service.js';
import { inferWorkType } from '../services/work-type.service.js';

const router = Router();

const supportAgent = new SupportAgent();
const mikrotikAgent = new MikrotikAgent();
const linuxAgent = new LinuxAgent();

async function processAgentRequest(classification, task) {
  const { deviceId, deviceType, deviceName, originalRequest } = classification;

  await taskService.updateTask(task.id, { status: 'diagnosing', deviceId, agentUsed: deviceType });
  await taskService.addTaskMessage(task.id, 'system', `Encaminhado para Agent ${deviceType.toUpperCase()}`);

  const agent = deviceType === 'mikrotik' ? mikrotikAgent : linuxAgent;

  try {
    const result = await agent.diagnose(deviceId, deviceName, originalRequest, task.taskNumber);

    const current = await taskService.getTaskById(task.id);
    if (current?.zabbixStatus === 'RESOLVED') {
      await taskService.addTaskMessage(task.id, 'agent', `${result.text}\n\nDiagnóstico finalizado após a recuperação; a Task permaneceu concluída.`, deviceType);
      return result.text;
    }

    await taskService.updateTask(task.id, {
      status: 'awaiting_approval',
      diagnosis: result.text,
      proposedSolution: result.text,
    });

    await taskService.addTaskMessage(task.id, 'agent', result.text, deviceType);

    return result.text;
  } catch (err) {
    const errorMsg = `❌ Erro no diagnóstico: ${err.message}`;
    await taskService.updateTask(task.id, { status: 'failed', diagnosis: errorMsg });
    await taskService.addTaskMessage(task.id, 'system', errorMsg);
    return errorMsg;
  }
}

// Evolution API Webhook (WhatsApp messages)
router.post('/evolution', async (req, res) => {
  const suppliedToken = req.headers['x-webhook-token'];
  if (!config.evolutionWebhookToken || suppliedToken !== config.evolutionWebhookToken) {
    return res.status(401).send('Invalid webhook token');
  }
  res.status(200).send('OK');

  try {
    const parsed = evolutionService.parseIncomingMessage(req.body);
    if (!parsed || !parsed.text || parsed.isFromMe) return;

    const isAuthorized = await evolutionService.isAuthorizedNumber(parsed.from);
    if (!isAuthorized) {
      logger.warn(`Unauthorized WhatsApp number: ${parsed.from}`);
      return;
    }

    logger.info(`WhatsApp message from ${parsed.from}: ${parsed.text}`);

    // Check if it's a task approval response
    const taskApprovalMatch = parsed.text.match(/#?TASK-?(\d+)/i);
    const isYes = /\b(sim|yes|s|y|confirma|aprovar|aplica)\b/i.test(parsed.text);
    const isNo = /\b(não|nao|no|n|cancela|cancelar|rejeitar)\b/i.test(parsed.text);

    if (taskApprovalMatch && (isYes || isNo)) {
      const taskNumber = parseInt(taskApprovalMatch[1]);
      const task = await taskService.processApproval(taskNumber, isYes);

      if (!task) {
        await evolutionService.sendWhatsAppMessage(parsed.from,
          `⚠️ Task #${taskNumber} não encontrada ou não está aguardando aprovação.`
        );
        return;
      }

      if (isYes) {
        await evolutionService.sendWhatsAppMessage(parsed.from,
          `✅ Task #${taskNumber} aprovada! Executando solução...`
        );
        await taskService.addTaskMessage(task.id, 'user', 'Solução APROVADA pelo admin');

        const agent = task.agentUsed === 'mikrotik' ? mikrotikAgent : linuxAgent;
        const result = await agent.executeSolution(
          task.deviceId, task.device?.name || 'Unknown', task.proposedSolution, taskNumber
        );

        const resolvedTask = await taskService.updateTask(task.id, {
          status: 'resolved',
          executionResult: result.text,
          resolutionSummary: result.text,
          resolutionType: 'agent',
          resolvedAt: new Date(),
        });
        await taskService.addTaskMessage(task.id, 'agent', result.text, task.agentUsed);
        await notifyTask(resolvedTask, 'resolved', { message: 'Solução executada pelo agente após aprovação via WhatsApp.', io: req.app.get('io') });
        await evolutionService.sendWhatsAppMessage(parsed.from, result.text);
      } else {
        await taskService.addTaskMessage(task.id, 'user', 'Solução REJEITADA pelo admin');
        await evolutionService.sendWhatsAppMessage(parsed.from,
          `❌ Task #${taskNumber} cancelada. Nenhuma ação foi tomada.`
        );
      }
      return;
    }

    // New request → classify and process
    const task = await taskService.createTask({
      source: 'whatsapp',
      originalMessage: parsed.text,
    });

    await taskService.addTaskMessage(task.id, 'user', parsed.text);

    const classification = await supportAgent.classify(parsed.text, 'whatsapp');

    if (classification.action === 'route_to_specialist') {
      await taskService.updateTask(task.id, { workType: inferWorkType(parsed.text, 'whatsapp', classification.requestType) });
      const response = await processAgentRequest(classification, task);
      await evolutionService.sendWhatsAppMessage(parsed.from, response);
    } else {
      const msg = classification.message || 'Não consegui identificar o dispositivo. Verifique se ele está cadastrado no sistema.';
      await taskService.updateTask(task.id, { status: 'failed', diagnosis: msg });
      await taskService.addTaskMessage(task.id, 'agent', msg, 'support');
      await evolutionService.sendWhatsAppMessage(parsed.from, msg);
    }
  } catch (err) {
    logger.error(`Webhook evolution error: ${err.message}`, { stack: err.stack });
  }
});

// Zabbix Webhook
router.post('/zabbix', async (req, res) => {
  const token = req.headers['x-zabbix-token'] || req.query.token;
  
  // Read expected token from database
  let expectedToken = config.zabbix.webhookToken;
  try {
    const { decrypt } = await import('../utils/crypto.js');
    const setting = await prisma.settings.findUnique({ where: { key: 'zabbix_webhook_token' } });
    if (setting && setting.value) {
      expectedToken = setting.encrypted ? decrypt(setting.value) : setting.value;
    }
  } catch (err) {
    logger.error(`Error reading zabbix token from DB: ${err.message}`);
  }

  if (!expectedToken || token !== expectedToken) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  res.status(200).json({ status: 'received' });

  try {
    const alert = parseZabbixAlert(req.body);
    if (!alert) return;

    logger.info(`Zabbix alert: ${alert.host} - ${alert.trigger}`);

    if (!alert.eventId) {
      logger.warn('Zabbix webhook ignored: eventId ausente ou macro não resolvida');
      return;
    }

    const now = new Date();
    const eventAt = alert.eventAt || now;

    if (alert.state === 'resolved') {
      const existing = await prisma.task.findUnique({ where: { zabbixEventId: alert.eventId }, include: { device: true } });
      if (!existing) {
        logger.warn(`Recovery órfã do Zabbix para EVENT.ID=${alert.eventId}`);
        return;
      }
      const resolvedAt = alert.recoveryAt || now;
      const openedAt = existing.incidentOpenedAt || existing.createdAt;
      const durationSeconds = Math.max(0, Math.floor((resolvedAt.getTime() - openedAt.getTime()) / 1000));
      const resolvedTask = await taskService.updateTask(existing.id, {
        status: 'resolved',
        zabbixStatus: 'RESOLVED',
        zabbixRecoveryId: alert.recoveryEventId,
        resolvedAt,
        lastSeenAt: resolvedAt,
        durationSeconds,
        resolutionSummary: 'Recuperação confirmada automaticamente pelo Zabbix.',
        resolutionType: 'zabbix',
        executionResult: `Resolvido automaticamente pelo Zabbix em ${resolvedAt.toLocaleString('pt-BR', { timeZone: 'America/Porto_Velho' })}.`,
      });
      await taskService.addTaskMessage(existing.id, 'system', `Evento Zabbix recuperado${alert.recoveryEventId ? ` (#${alert.recoveryEventId})` : ''}. Duração: ${durationSeconds}s.`);
      await notifyTask(resolvedTask, 'resolved', { message: `Recuperação confirmada pelo Zabbix. Duração: ${durationSeconds}s.`, io: req.app.get('io') });
      logger.info(`Task #${existing.taskNumber} resolved by Zabbix EVENT.ID=${alert.eventId}`);
      return;
    }

    const exactEvent = await prisma.task.findUnique({ where: { zabbixEventId: alert.eventId } });
    if (exactEvent) {
      await taskService.updateTask(exactEvent.id, {
        lastSeenAt: eventAt,
        duplicateCount: { increment: 1 },
        zabbixStatus: 'PROBLEM',
      });
      await taskService.addTaskMessage(exactEvent.id, 'system', `Notificação duplicada do EVENT.ID=${alert.eventId} ignorada.`);
      logger.info(`Duplicate Zabbix EVENT.ID=${alert.eventId} linked to Task #${exactEvent.taskNumber}`);
      return;
    }

    const related = await prisma.task.findFirst({
      where: { source: 'zabbix', incidentKey: alert.incidentKey },
      orderBy: { updatedAt: 'desc' },
      include: { device: true },
    });

    let task;
    if (related) {
      const reopenedSla = await buildSlaFields(alert.priority, eventAt);
      task = await taskService.updateTask(related.id, {
        status: 'pending',
        originalMessage: formatAlertMessage(alert),
        priority: alert.priority,
        zabbixEventId: alert.eventId,
        zabbixRecoveryId: null,
        zabbixStatus: 'PROBLEM',
        incidentOpenedAt: eventAt,
        lastSeenAt: eventAt,
        resolvedAt: null,
        validatedAt: null,
        closedAt: null,
        durationSeconds: null,
        occurrenceCount: { increment: 1 },
        adminResponse: null,
        executionResult: null,
        resolutionSummary: null,
        resolutionType: null,
        ...reopenedSla,
        slaWarningSentAt: null,
        slaAckBreachedAt: null,
        slaResolveBreachedAt: null,
      });
      await taskService.addTaskMessage(task.id, 'system', `Incidente reaberto pelo Zabbix com EVENT.ID=${alert.eventId}.`);
      logger.info(`Task #${task.taskNumber} reopened for Zabbix EVENT.ID=${alert.eventId}`);
    } else {
      task = await taskService.createTask({
        source: 'zabbix',
        originalMessage: formatAlertMessage(alert),
        priority: alert.priority,
        incident: {
          zabbixEventId: alert.eventId,
          zabbixStatus: 'PROBLEM',
          incidentKey: alert.incidentKey,
          incidentOpenedAt: eventAt,
          lastSeenAt: eventAt,
        },
      });
      await taskService.addTaskMessage(task.id, 'system', `Alerta Zabbix: ${alert.trigger}`);
    }

    await notifyTask(task, related ? 'reopened' : 'opened', { message: formatAlertMessage(alert), io: req.app.get('io') });

    // Try to find the device by hostname or zabbixHostId
    const classificationMsg = `Alerta do Zabbix:
Host: ${alert.host}
${alert.hostId ? `Zabbix Host ID: ${alert.hostId}` : ''}
Trigger: ${alert.trigger}
Severidade: ${alert.severity}
${alert.itemName ? `Item: ${alert.itemName} = ${alert.itemValue}` : ''}

Identifique o dispositivo e encaminhe para diagnóstico.`;

    const devices = await prisma.device.findMany({ where: { isActive: true } });
    const directDevice = devices.find(device =>
      (alert.hostId && device.zabbixHostId === alert.hostId) ||
      device.name.toLowerCase() === alert.host.toLowerCase() ||
      device.hostname.toLowerCase() === alert.host.toLowerCase()
    );
    const automationMode = await getIncidentAutomationMode();
    const autoDiagnose = shouldAutoDiagnoseIncident(alert.priority, automationMode);
    await taskService.addTaskMessage(task.id, 'system', describeIncidentPolicy(automationMode, alert.priority));

    if (!autoDiagnose) {
      if (directDevice) {
        await taskService.updateTask(task.id, { deviceId: directDevice.id, agentUsed: directDevice.type, status: 'pending' });
      }
      logger.info(`Task #${task.taskNumber} awaiting manual analysis (mode=${automationMode}, priority=${alert.priority})`);
      return;
    }

    const classification = directDevice ? {
      action: 'route_to_specialist',
      deviceId: directDevice.id,
      deviceType: directDevice.type,
      deviceName: directDevice.name,
      originalRequest: classificationMsg,
    } : await supportAgent.classify(classificationMsg, 'zabbix');

    if (classification.action === 'route_to_specialist') {
      const response = await processAgentRequest(classification, task);
      await evolutionService.sendToAdmin(response);
    } else {
      const msg = `⚠️ Alerta Zabbix recebido mas dispositivo não identificado:\n${formatAlertMessage(alert)}`;
      await taskService.updateTask(task.id, { status: 'failed', diagnosis: msg });
      await taskService.addTaskMessage(task.id, 'system', msg);
      await evolutionService.sendToAdmin(msg);
    }
  } catch (err) {
    logger.error(`Webhook zabbix error: ${err.message}`, { stack: err.stack });
  }
});

export default router;
