import { Router } from 'express';
import * as taskService from '../services/task.service.js';
import prisma from '../database/client.js';
import MikrotikAgent from '../agents/mikrotik-agent.js';
import LinuxAgent from '../agents/linux-agent.js';

const router = Router();

const TRANSITIONS = {
  acknowledge: { from: ['pending', 'failed'], to: 'in_progress' },
  resolve: { from: ['pending', 'in_progress', 'diagnosing', 'awaiting_approval', 'executing', 'failed'], to: 'resolved' },
  validate: { from: ['resolved', 'completed'], to: 'validated' },
  close: { from: ['resolved', 'completed', 'validated'], to: 'closed' },
  reopen: { from: ['resolved', 'completed', 'validated', 'closed', 'cancelled', 'failed'], to: 'pending' },
  cancel: { from: ['pending', 'in_progress', 'diagnosing', 'awaiting_approval', 'failed'], to: 'cancelled' },
};

router.post('/:id/workflow', async (req, res, next) => {
  try {
    const task = await taskService.getTaskById(req.params.id);
    if (!task) return res.status(404).json({ success: false, error: 'Task não encontrada' });
    const action = String(req.body.action || '');
    const actor = String(req.body.actor || 'Administrador').trim().slice(0, 100) || 'Administrador';
    const note = String(req.body.note || '').trim().slice(0, 2000);

    if (action === 'assign') {
      const assignedTo = String(req.body.assignedTo || '').trim().slice(0, 100);
      if (!assignedTo) return res.status(400).json({ success: false, error: 'Informe o responsável' });
      const dueAt = req.body.dueAt ? new Date(req.body.dueAt) : null;
      if (dueAt && Number.isNaN(dueAt.getTime())) return res.status(400).json({ success: false, error: 'Prazo inválido' });
      const updated = await taskService.updateTask(task.id, { assignedTo, dueAt });
      await taskService.addTaskMessage(task.id, 'system', `${actor} atribuiu a Task para ${assignedTo}${dueAt ? ` com prazo até ${dueAt.toLocaleString('pt-BR')}` : ''}.${note ? ` Observação: ${note}` : ''}`);
      return res.json({ success: true, data: updated });
    }

    if (action === 'comment') {
      if (!note) return res.status(400).json({ success: false, error: 'Escreva um comentário' });
      await taskService.addTaskMessage(task.id, 'user', `${actor}: ${note}`);
      return res.json({ success: true, data: await taskService.getTaskById(task.id) });
    }

    const transition = TRANSITIONS[action];
    if (!transition) return res.status(400).json({ success: false, error: 'Ação de workflow inválida' });
    if (!transition.from.includes(task.status)) {
      return res.status(409).json({ success: false, error: `Não é possível executar "${action}" no estado atual (${task.status})` });
    }

    const now = new Date();
    const data = { status: transition.to };
    if (action === 'acknowledge') {
      data.acknowledgedAt = now;
      if (!task.assignedTo) data.assignedTo = actor;
    }
    if (action === 'resolve') {
      if (!note) return res.status(400).json({ success: false, error: 'Informe como o incidente foi resolvido' });
      data.resolvedAt = now;
      data.resolutionSummary = note;
      data.resolutionType = req.body.resolutionType === 'agent' ? 'agent' : 'manual';
      data.executionResult = note;
    }
    if (action === 'validate') data.validatedAt = now;
    if (action === 'close') data.closedAt = now;
    if (action === 'reopen') Object.assign(data, { resolvedAt: null, validatedAt: null, closedAt: null, resolutionSummary: null, resolutionType: null, adminResponse: null });

    const labels = { acknowledge: 'reconheceu e iniciou o atendimento', resolve: 'marcou como resolvida', validate: 'validou a resolução', close: 'encerrou', reopen: 'reabriu', cancel: 'cancelou' };
    const updated = await taskService.updateTask(task.id, data);
    await taskService.addTaskMessage(task.id, 'system', `${actor} ${labels[action]} a Task.${note && action !== 'resolve' ? ` Observação: ${note}` : ''}`);
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
});

router.get('/', async (req, res, next) => {
  try {
    const { status, source, priority, limit } = req.query;
    const tasks = await taskService.getAllTasks({
      status, source, priority, limit: limit ? parseInt(limit) : 50,
    });
    res.json({ success: true, data: tasks });
  } catch (err) { next(err); }
});

router.get('/stats', async (req, res, next) => {
  try {
    const stats = await taskService.getTaskStats();
    res.json({ success: true, data: stats });
  } catch (err) { next(err); }
});

router.post('/:id/reprocess', async (req, res, next) => {
  try {
    const task = await taskService.getTaskById(req.params.id);
    if (!task) return res.status(404).json({ success: false, error: 'Task não encontrada' });
    if (['executing', 'diagnosing'].includes(task.status)) {
      return res.status(409).json({ success: false, error: 'A Task já está sendo processada' });
    }

    const deviceId = req.body.deviceId || task.deviceId;
    if (!deviceId) return res.status(400).json({ success: false, error: 'Selecione um equipamento para reprocessar' });
    const device = await prisma.device.findUnique({ where: { id: deviceId } });
    if (!device || !device.isActive) return res.status(404).json({ success: false, error: 'Equipamento não encontrado ou inativo' });

    const agent = device.type === 'mikrotik' ? new MikrotikAgent() : device.type === 'linux' ? new LinuxAgent() : null;
    if (!agent) return res.status(400).json({ success: false, error: 'Tipo de equipamento sem agente disponível' });

    await taskService.updateTask(task.id, { status: 'diagnosing', deviceId, agentUsed: device.type, adminResponse: null });
    await taskService.addTaskMessage(task.id, 'system', `Reprocessamento manual iniciado para ${device.name}`);

    const result = await agent.diagnose(device.id, device.name, task.originalMessage, task.taskNumber);
    const needsApproval = /responda\s+com\s+sim|aguardando\s+aprova[cç][aã]o/i.test(result.text);
    const updated = await taskService.updateTask(task.id, {
      status: needsApproval ? 'awaiting_approval' : 'resolved',
      diagnosis: result.text,
      proposedSolution: needsApproval ? result.text : null,
      executionResult: needsApproval ? null : result.text,
    });
    await taskService.addTaskMessage(task.id, 'agent', result.text, device.type);
    res.json({ success: true, data: updated });
  } catch (err) {
    try { await taskService.updateTask(req.params.id, { status: 'failed', diagnosis: `Erro no reprocessamento: ${err.message}` }); } catch {}
    next(err);
  }
});

router.post('/:id/complete', async (req, res, next) => {
  try {
    const task = await taskService.getTaskById(req.params.id);
    if (!task) return res.status(404).json({ success: false, error: 'Task não encontrada' });
    if (['executing', 'diagnosing'].includes(task.status)) return res.status(409).json({ success: false, error: 'A Task está em processamento' });
    const note = String(req.body.note || 'Concluída manualmente pelo administrador').slice(0, 1000);
    const updated = await taskService.updateTask(task.id, { status: 'resolved', executionResult: note, resolutionSummary: note, resolutionType: 'manual', resolvedAt: new Date(), adminResponse: 'manual' });
    await taskService.addTaskMessage(task.id, 'user', note);
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const task = await taskService.getTaskById(req.params.id);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
    res.json({ success: true, data: task });
  } catch (err) { next(err); }
});

router.get('/number/:taskNumber', async (req, res, next) => {
  try {
    const task = await taskService.getTaskByNumber(parseInt(req.params.taskNumber));
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
    res.json({ success: true, data: task });
  } catch (err) { next(err); }
});

export default router;
