import prisma from '../database/client.js';
import logger from '../utils/logger.js';

export async function createTask({ source, originalMessage, deviceId, priority, incident = {} }) {
  const lastTask = await prisma.task.findFirst({ orderBy: { taskNumber: 'desc' } });
  const taskNumber = (lastTask?.taskNumber || 0) + 1;

  const task = await prisma.task.create({
    data: {
      taskNumber,
      source,
      originalMessage,
      deviceId: deviceId || null,
      priority: priority || 'medium',
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

export async function getAllTasks({ status, source, priority, limit = 50 }) {
  const where = {};
  if (status) where.status = status;
  if (source) where.source = source;
  if (priority) where.priority = priority;

  return prisma.task.findMany({
    where,
    include: { device: true },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

export async function getTaskStats() {
  const [total, pending, inProgress, diagnosing, awaiting, resolved, validated, closed, failed] = await Promise.all([
    prisma.task.count(),
    prisma.task.count({ where: { status: 'pending' } }),
    prisma.task.count({ where: { status: 'in_progress' } }),
    prisma.task.count({ where: { status: 'diagnosing' } }),
    prisma.task.count({ where: { status: 'awaiting_approval' } }),
    prisma.task.count({ where: { status: { in: ['resolved', 'completed'] } } }),
    prisma.task.count({ where: { status: 'validated' } }),
    prisma.task.count({ where: { status: 'closed' } }),
    prisma.task.count({ where: { status: 'failed' } }),
  ]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const completedToday = await prisma.task.count({
    where: { status: { in: ['resolved', 'completed', 'validated', 'closed'] }, resolvedAt: { gte: today } },
  });

  return { total, pending, inProgress, diagnosing, awaiting, completed: resolved, resolved, validated, closed, failed, completedToday };
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
