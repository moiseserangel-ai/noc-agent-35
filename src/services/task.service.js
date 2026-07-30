import prisma from '../database/client.js';
import logger from '../utils/logger.js';
import { buildSlaFields } from './sla.service.js';
import { inferWorkType } from './work-type.service.js';

export async function createTask({ source, originalMessage, deviceId, priority, workType, incident = {} }) {
  const lastTask = await prisma.task.findFirst({ orderBy: { taskNumber: 'desc' } });
  const taskNumber = (lastTask?.taskNumber || 0) + 1;

  const openedAt = incident.incidentOpenedAt || new Date();
  const sla = await buildSlaFields(priority || 'medium', openedAt);
  const scopedDevice=deviceId?await prisma.device.findUnique({where:{id:deviceId},select:{tenantId:true}}):null;
  const task = await prisma.task.create({
    data: {
      taskNumber,
      source,
      workType: inferWorkType(originalMessage, source, workType),
      originalMessage,
      deviceId: deviceId || null,
      tenantId:scopedDevice?.tenantId||null,
      priority: priority || 'medium',
      ...sla,
      ...incident,
    },
    include: { device: true },
  });

  await addTaskMessage(task.id, 'system', `Task #${taskNumber} criada via ${source}`);
  logger.info(`Task #${taskNumber} created from ${source}`);
  return task;
}

export async function updateTask(id, data) {
  return prisma.task.update({
    where: { id },
    data,
    include: { device: true, messages: { orderBy: { createdAt: 'asc' } } },
  });
}

export async function getTaskById(id) {
  return prisma.task.findUnique({
    where: { id },
    include: { device: true, messages: { orderBy: { createdAt: 'asc' } } },
  });
}

export async function getTaskByNumber(taskNumber) {
  return prisma.task.findUnique({
    where: { taskNumber },
    include: { device: true, messages: { orderBy: { createdAt: 'asc' } } },
  });
}

export async function getAllTasks({ status, source, priority, sla, limit = 50,tenantId=null }) {
  const where = {};
  if (status) where.status = status;
  if (source) where.source = source;
  if (priority) where.priority = priority;
  if (sla === 'breached') where.slaResolveBreachedAt = { not: null };
  if(tenantId)where.tenantId=tenantId;

  return prisma.task.findMany({
    where,
    include: { device: true },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

export async function getTaskStats(tenantId=null) {
  const scope=tenantId?{tenantId}:{};
  const [total, pending, inProgress, diagnosing, awaiting, resolved, validated, closed, failed, slaBreached] = await Promise.all([
    prisma.task.count({where:scope}),
    prisma.task.count({ where: { ...scope,status: 'pending' } }),
    prisma.task.count({ where: { ...scope,status: 'in_progress' } }),
    prisma.task.count({ where: { ...scope,status: 'diagnosing' } }),
    prisma.task.count({ where: { ...scope,status: 'awaiting_approval' } }),
    prisma.task.count({ where: { ...scope,status: { in: ['resolved', 'completed'] } } }),
    prisma.task.count({ where: { ...scope,status: 'validated' } }),
    prisma.task.count({ where: { ...scope,status: 'closed' } }),
    prisma.task.count({ where: { ...scope,status: 'failed' } }),
    prisma.task.count({ where: { ...scope,status: { notIn: ['resolved', 'completed', 'validated', 'closed', 'cancelled'] }, slaResolveBreachedAt: { not: null } } }),
  ]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const completedToday = await prisma.task.count({
    where: { ...scope,status: { in: ['resolved', 'completed', 'validated', 'closed'] }, resolvedAt: { gte: today } },
  });

  return { total, pending, inProgress, diagnosing, awaiting, completed: resolved, resolved, validated, closed, failed, slaBreached, completedToday };
}

export async function addTaskMessage(taskId, role, content, agentName = null) {
  return prisma.taskMessage.create({
    data: { taskId, role, content, agentName },
  });
}

export async function processApproval(taskNumber, approved) {
  const task = await getTaskByNumber(taskNumber);
  if (!task) return null;
  if (task.status !== 'awaiting_approval') return null;

  return updateTask(task.id, {
    adminResponse: approved ? 'yes' : 'no',
    status: approved ? 'executing' : 'cancelled',
  });
}
