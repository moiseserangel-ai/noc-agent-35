import { Router } from 'express';
import prisma from '../database/client.js';

const router = Router();
router.get('/', async (req, res, next) => { try {
  const where = {};
  if (req.query.username) where.username = { contains: String(req.query.username).slice(0, 80) };
  if (req.query.action) where.action = String(req.query.action);
  if (req.query.resource) where.resource = String(req.query.resource);
  if (req.query.status) where.status = String(req.query.status);
  if (req.query.from || req.query.to) where.createdAt = { ...(req.query.from && { gte: new Date(req.query.from) }), ...(req.query.to && { lte: new Date(`${req.query.to}T23:59:59.999`) }) };
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  const data = await prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit });
  res.json({ success: true, data });
} catch (e) { next(e); } });
router.get('/options', async (_req, res, next) => { try {
  const [users, resources, actions] = await Promise.all([
    prisma.auditLog.findMany({ distinct: ['username'], select: { username: true }, orderBy: { username: 'asc' } }),
    prisma.auditLog.findMany({ distinct: ['resource'], select: { resource: true }, orderBy: { resource: 'asc' } }),
    prisma.auditLog.findMany({ distinct: ['action'], select: { action: true }, orderBy: { action: 'asc' } }),
  ]);
  res.json({ success: true, data: { users: users.map(x => x.username), resources: resources.map(x => x.resource), actions: actions.map(x => x.action) } });
} catch (e) { next(e); } });
export default router;
