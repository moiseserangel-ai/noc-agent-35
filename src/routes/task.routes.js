import { Router } from 'express';
import * as taskService from '../services/task.service.js';
import prisma from '../database/client.js';
import MikrotikAgent from '../agents/mikrotik-agent.js';
import LinuxAgent from '../agents/linux-agent.js';

const router = Router();

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
      status: needsApproval ? 'awaiting_approval' : 'completed',
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
    const updated = await taskService.updateTask(task.id, { status: 'completed', executionResult: note, adminResponse: 'manual' });
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
