import prisma from '../database/client.js';
import logger from '../utils/logger.js';

export const DEFAULT_SLA = {
  low: { acknowledge: 240, resolve: 1440 },
  medium: { acknowledge: 60, resolve: 480 },
  high: { acknowledge: 15, resolve: 120 },
  critical: { acknowledge: 5, resolve: 30 },
};

const TERMINAL_STATUSES = ['resolved', 'completed', 'validated', 'closed', 'cancelled'];

const numberSetting = (settings, key, fallback) => {
  const parsed = Number(settings.get(key));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
export const tenantSlaValue=(tenant,key,fallback)=>Number(tenant?.[key])>0?Number(tenant[key]):fallback;

export async function getSlaPolicy(priority = 'medium',tenantId=null) {
  const safePriority = DEFAULT_SLA[priority] ? priority : 'medium';
  const rows = await prisma.settings.findMany({ where: { key: { startsWith: 'sla_' } } });
  const settings = new Map(rows.map(row => [row.key, row.value]));
  const tenant=tenantId?await prisma.tenant.findUnique({where:{id:tenantId},select:{slaLowAck:true,slaLowResolve:true,slaMediumAck:true,slaMediumResolve:true,slaHighAck:true,slaHighResolve:true,slaCriticalAck:true,slaCriticalResolve:true}}):null;
  const prefix={low:'Low',medium:'Medium',high:'High',critical:'Critical'}[safePriority];
  const globalAck=numberSetting(settings, `sla_${safePriority}_ack_minutes`, DEFAULT_SLA[safePriority].acknowledge),globalResolve=numberSetting(settings, `sla_${safePriority}_resolve_minutes`, DEFAULT_SLA[safePriority].resolve);
  return {
    acknowledgeMinutes:tenantSlaValue(tenant,`sla${prefix}Ack`,globalAck),
    resolveMinutes:tenantSlaValue(tenant,`sla${prefix}Resolve`,globalResolve),
    warningPercent: Math.min(95, numberSetting(settings, 'sla_warning_percent', 80)),
  };
}

export async function buildSlaFields(priority, openedAt = new Date(),tenantId=null) {
  const policy = await getSlaPolicy(priority,tenantId);
  return {
    slaAckDueAt: new Date(openedAt.getTime() + policy.acknowledgeMinutes * 60_000),
    slaResolveDueAt: new Date(openedAt.getTime() + policy.resolveMinutes * 60_000),
    escalationLevel: 0,
    criticalEscalationLevel: 0,
  };
}

export function evaluateTaskSla(task, now = new Date(), warningPercent = 80) {
  if (TERMINAL_STATUSES.includes(task.status)) return { terminal: true, warning: false, ackBreached: false, resolutionBreached: false };
  const openedAt = new Date(task.incidentOpenedAt || task.createdAt);
  const ackDue = task.slaAckDueAt ? new Date(task.slaAckDueAt) : null;
  const resolveDue = task.slaResolveDueAt ? new Date(task.slaResolveDueAt) : null;
  const warningAt = resolveDue ? new Date(openedAt.getTime() + (resolveDue.getTime() - openedAt.getTime()) * (warningPercent / 100)) : null;
  return {
    terminal: false,
    warning: Boolean(warningAt && now >= warningAt && now < resolveDue && !task.slaWarningSentAt),
    ackBreached: Boolean(!task.acknowledgedAt && ackDue && now >= ackDue && !task.slaAckBreachedAt),
    resolutionBreached: Boolean(resolveDue && now >= resolveDue && !task.slaResolveBreachedAt),
  };
}

export async function runSlaMonitor(onEscalation = async () => {}) {
  const tasks = await prisma.task.findMany({
    where: { status: { notIn: TERMINAL_STATUSES }, slaResolveDueAt: { not: null } },
    include: { device: true },
  });
  const settings = await prisma.settings.findUnique({ where: { key: 'sla_warning_percent' } });
  const warningPercent = Math.min(95, Number(settings?.value) || 80);
  const now = new Date();
  const events = [];

  for (const task of tasks) {
    const state = evaluateTaskSla(task, now, warningPercent);
    const data = {};
    const messages = [];
    let level = task.escalationLevel || 0;
    if (state.warning) {
      data.slaWarningSentAt = now;
      level = Math.max(level, 1);
      messages.push(`⏳ SLA próximo do vencimento para a Task #${task.taskNumber}.`);
    }
    if (state.ackBreached) {
      data.slaAckBreachedAt = now;
      level = Math.max(level, 2);
      messages.push(`⚠️ SLA de reconhecimento violado na Task #${task.taskNumber}.`);
    }
    if (state.resolutionBreached) {
      data.slaResolveBreachedAt = now;
      level = Math.max(level, 3);
      messages.push(`🚨 SLA de resolução violado na Task #${task.taskNumber}.`);
    }
    if (messages.length === 0) continue;
    data.escalationLevel = level;
    await prisma.task.update({ where: { id: task.id }, data });
    for (const message of messages) {
      await prisma.taskMessage.create({ data: { taskId: task.id, role: 'system', content: message } });
      events.push({ task, message, level });
      try { await onEscalation(task, message, level); } catch (err) { logger.warn(`SLA notification failed: ${err.message}`); }
    }
  }
  return events;
}
