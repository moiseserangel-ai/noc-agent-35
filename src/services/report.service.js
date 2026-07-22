import prisma from '../database/client.js';

const TERMINAL = ['resolved', 'completed', 'validated', 'closed'];
const TZ = 'America/Porto_Velho';
const dayKey = date => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const average = values => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
const distribution = (tasks, key) => Object.entries(tasks.reduce((acc, task) => { const value = (typeof key === 'function' ? key(task) : task[key]) || 'unknown'; acc[value] = (acc[value] || 0) + 1; return acc; }, {})).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

export function resolveReportPeriod(query = {}) {
  const now = new Date();
  const days = Math.min(Math.max(Number(query.days) || 30, 1), 366);
  const from = query.from ? new Date(`${query.from}T00:00:00-04:00`) : new Date(now.getTime() - (days - 1) * 86_400_000);
  const to = query.to ? new Date(`${query.to}T23:59:59.999-04:00`) : now;
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) throw Object.assign(new Error('Período inválido'), { statusCode: 400 });
  if (to.getTime() - from.getTime() > 367 * 86_400_000) throw Object.assign(new Error('O período máximo é de 366 dias'), { statusCode: 400 });
  return { from, to };
}

export async function buildIncidentReport(query = {}) {
  const period = resolveReportPeriod(query);
  const tasks = await prisma.task.findMany({ where: { createdAt: { gte: period.from, lte: period.to } }, include: { device: { select: { id: true, name: true, type: true } } }, orderBy: { createdAt: 'desc' } });
  const incidentTasks = tasks.filter(task => task.workType === 'incident');
  const resolved = tasks.filter(task => task.resolvedAt || TERMINAL.includes(task.status));
  const resolvedIncidents = incidentTasks.filter(task => task.resolvedAt || TERMINAL.includes(task.status));
  const mttaValues = incidentTasks.filter(task => task.acknowledgedAt).map(task => Math.max(0, Math.round((new Date(task.acknowledgedAt) - new Date(task.incidentOpenedAt || task.createdAt)) / 1000)));
  const mttrValues = resolvedIncidents.filter(task => task.resolvedAt).map(task => Math.max(0, Math.round((new Date(task.resolvedAt) - new Date(task.incidentOpenedAt || task.createdAt)) / 1000)));
  const slaEligible = resolvedIncidents.filter(task => task.slaResolveDueAt && task.resolvedAt);
  const slaCompliant = slaEligible.filter(task => new Date(task.resolvedAt) <= new Date(task.slaResolveDueAt));
  const ackEligible = incidentTasks.filter(task => task.slaAckDueAt && task.acknowledgedAt);
  const ackCompliant = ackEligible.filter(task => new Date(task.acknowledgedAt) <= new Date(task.slaAckDueAt));

  const dailyMap = new Map();
  for (let cursor = new Date(period.from); cursor <= period.to; cursor = new Date(cursor.getTime() + 86_400_000)) dailyMap.set(dayKey(cursor), { date: dayKey(cursor), opened: 0, resolved: 0, incidents: 0, consultations: 0, configurations: 0 });
  for (const task of tasks) {
    const openedKey = dayKey(new Date(task.createdAt));
    if (dailyMap.has(openedKey)) dailyMap.get(openedKey).opened += 1;
    if (dailyMap.has(openedKey)) dailyMap.get(openedKey)[task.workType === 'consultation' ? 'consultations' : task.workType === 'configuration' ? 'configurations' : 'incidents'] += 1;
    if (task.resolvedAt) { const resolvedKey = dayKey(new Date(task.resolvedAt)); if (dailyMap.has(resolvedKey)) dailyMap.get(resolvedKey).resolved += 1; }
  }
  const deviceMap = new Map();
  for (const task of tasks) { const name = task.device?.name || 'Não identificado'; const row = deviceMap.get(name) || { name, incidents: 0, critical: 0, resolved: 0 }; row.incidents += 1; if (task.priority === 'critical') row.critical += 1; if (task.resolvedAt || TERMINAL.includes(task.status)) row.resolved += 1; deviceMap.set(name, row); }

  return {
    period: { from: period.from, to: period.to, timezone: TZ },
    summary: {
      total: tasks.length, resolved: resolved.length, open: tasks.length - resolved.length,
      resolutionRate: tasks.length ? Math.round(resolved.length / tasks.length * 1000) / 10 : 0,
      mttaSeconds: average(mttaValues), mttrSeconds: average(mttrValues),
      slaCompliance: slaEligible.length ? Math.round(slaCompliant.length / slaEligible.length * 1000) / 10 : null,
      ackCompliance: ackEligible.length ? Math.round(ackCompliant.length / ackEligible.length * 1000) / 10 : null,
      slaBreached: incidentTasks.filter(task => task.slaResolveBreachedAt).length,
    },
    byPriority: distribution(tasks, 'priority'), byStatus: distribution(tasks, 'status'), bySource: distribution(tasks, task => String(task.source).startsWith('dashboard:') ? 'dashboard' : task.source), byWorkType: distribution(tasks, 'workType'),
    daily: [...dailyMap.values()],
    topDevices: [...deviceMap.values()].sort((a, b) => b.incidents - a.incidents).slice(0, 10),
    workTypes: { incidents: tasks.filter(x => x.workType === 'incident').length, consultations: tasks.filter(x => x.workType === 'consultation').length, configurations: tasks.filter(x => x.workType === 'configuration').length },
    incidents: tasks.slice(0, 500).map(task => ({ taskNumber: task.taskNumber, createdAt: task.createdAt, resolvedAt: task.resolvedAt, device: task.device?.name || '', source: task.source, workType: task.workType, priority: task.priority, status: task.status, mttaSeconds: task.acknowledgedAt ? Math.max(0, Math.round((new Date(task.acknowledgedAt) - new Date(task.incidentOpenedAt || task.createdAt)) / 1000)) : null, mttrSeconds: task.resolvedAt ? Math.max(0, Math.round((new Date(task.resolvedAt) - new Date(task.incidentOpenedAt || task.createdAt)) / 1000)) : null, slaBreached: Boolean(task.slaResolveBreachedAt) })),
  };
}
