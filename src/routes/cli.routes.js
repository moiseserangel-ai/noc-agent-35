import { Router } from 'express';
import prisma from '../database/client.js';
import { requestIdentity, logAudit } from '../services/audit.service.js';
import { classifyCliCommand, closeCliSession, createCliSession, executeCliCommand, getOwnedSession } from '../services/cli.service.js';

const router = Router();
const publicDevice = { id: true, name: true, hostname: true, port: true, type: true, manufacturer: true, model: true, group: true, isActive: true };

router.get('/devices', async (_req, res, next) => {
  try {
    const devices = await prisma.device.findMany({
      where: { isActive: true, type: { in: ['mikrotik', 'linux', 'huawei_vrp'] } },
      select: publicDevice,
      orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: devices });
  } catch (error) { next(error); }
});

router.get('/sessions', async (req, res, next) => {
  try {
    const sessions = await prisma.cliSession.findMany({
      where: req.user.role === 'admin' && req.query.all === 'true' ? {} : { userId: req.user.sub },
      include: { _count: { select: { commands: true } } },
      orderBy: { startedAt: 'desc' },
      take: Math.min(Number(req.query.limit) || 20, 100),
    });
    res.json({ success: true, data: sessions });
  } catch (error) { next(error); }
});

router.post('/sessions', async (req, res, next) => {
  try {
    const device = await prisma.device.findFirst({ where: { id: req.body.deviceId, isActive: true }, select: publicDevice });
    if (!device) return res.status(404).json({ success: false, error: 'Equipamento não encontrado ou inativo.' });
    if (!classifyCliCommand(device.type, 'display version').valid && device.type !== 'mikrotik' && device.type !== 'linux') {
      return res.status(400).json({ success: false, error: 'Tipo de equipamento sem suporte ao Terminal CLI.' });
    }
    const session = await createCliSession({ user: req.user, device, ipAddress: req.ip, userAgent: req.get('user-agent') });
    await logAudit({ ...requestIdentity(req), action: 'cli_session_open', resource: 'cli_session', resourceId: session.id, details: { deviceId: device.id, deviceName: device.name, hostname: device.hostname } });
    res.status(201).json({ success: true, data: session });
  } catch (error) { next(error); }
});

router.get('/sessions/:id/commands', async (req, res, next) => {
  try {
    const session = await getOwnedSession(req.params.id, req.user);
    if (!session) return res.status(404).json({ success: false, error: 'Sessão CLI não encontrada.' });
    const commands = await prisma.cliCommand.findMany({ where: { sessionId: session.id }, orderBy: { createdAt: 'asc' }, take: 500 });
    res.json({ success: true, data: { session, commands } });
  } catch (error) { next(error); }
});

router.post('/sessions/:id/commands', async (req, res, next) => {
  try {
    const session = await getOwnedSession(req.params.id, req.user);
    if (!session) return res.status(404).json({ success: false, error: 'Sessão CLI não encontrada.' });
    if (session.userId !== req.user.sub) return res.status(403).json({ success: false, error: 'Não é permitido executar comandos em uma sessão de outro usuário.' });
    if (session.status !== 'active') return res.status(409).json({ success: false, error: 'Esta sessão CLI não está mais ativa.' });
    const policy = classifyCliCommand(session.deviceType, req.body.command);
    if (!policy.valid) return res.status(400).json({ success: false, error: policy.reason });
    if (policy.type === 'change' && !req.body.confirmed) {
      return res.json({ success: true, requiresConfirmation: true, data: { commandType: 'change', command: req.body.command } });
    }
    const command = await executeCliCommand({ session, user: req.user, command: req.body.command, justification: req.body.justification });
    await logAudit({
      ...requestIdentity(req),
      action: command.commandType === 'change' ? 'cli_change' : 'cli_read',
      resource: 'device',
      resourceId: session.deviceId,
      status: command.status === 'success' ? 'success' : 'failure',
      details: { cliSessionId: session.id, deviceName: session.deviceName, command: command.command, justification: command.justification, result: command.status, durationMs: command.durationMs },
    });
    res.json({ success: true, data: command });
  } catch (error) { next(error); }
});

router.post('/sessions/:id/close', async (req, res, next) => {
  try {
    const session = await getOwnedSession(req.params.id, req.user);
    if (!session) return res.status(404).json({ success: false, error: 'Sessão CLI não encontrada.' });
    if (session.userId !== req.user.sub && req.user.role !== 'admin') return res.status(403).json({ success: false, error: 'Sem permissão.' });
    const closed = session.status === 'active' ? await closeCliSession(session.id) : session;
    await logAudit({ ...requestIdentity(req), action: 'cli_session_close', resource: 'cli_session', resourceId: session.id, details: { deviceId: session.deviceId, deviceName: session.deviceName } });
    res.json({ success: true, data: closed });
  } catch (error) { next(error); }
});

export default router;
