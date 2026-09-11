import prisma from '../database/client.js';

export function normalizeChangeComment(value) {
  const comment = String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240);
  if (comment.length < 10) throw new Error('Informe um comentário com pelo menos 10 caracteres descrevendo a alteração.');
  return comment;
}

export function formatChangeMarker(comment, taskNumber) {
  return `NOC-Agent${taskNumber ? ` #TASK-${taskNumber}` : ''} — ${normalizeChangeComment(comment)}`;
}

export async function recordDeviceChange({ deviceId, taskNumber, agentName, comment, nativeAudit, status = 'applied' }) {
  const normalized = normalizeChangeComment(comment);
  const change = await prisma.deviceChange.create({ data: { deviceId, taskNumber: taskNumber || null, agentName, comment: normalized, nativeAudit: nativeAudit || null, status } });
  if (taskNumber) {
    const task = await prisma.task.findUnique({ where: { taskNumber }, select: { id: true } });
    if (task) await prisma.taskMessage.create({ data: { taskId: task.id, role: 'system', agentName, content: `📝 Comentário de alteração registrado no equipamento: ${normalized}${nativeAudit ? ` (${nativeAudit})` : ''}` } });
  }
  return change;
}

export async function getDeviceChanges(deviceId, limit = 100) {
  return prisma.deviceChange.findMany({ where: { deviceId }, orderBy: { createdAt: 'desc' }, take: Math.min(Math.max(Number(limit) || 100, 1), 500) });
}
