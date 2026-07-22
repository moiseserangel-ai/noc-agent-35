import { Router } from 'express';
import prisma from '../database/client.js';
import { createUser, hashPassword, publicUser } from '../services/user.service.js';

const router = Router();
router.get('/', async (_req, res, next) => { try { res.json({ success: true, data: (await prisma.user.findMany({ orderBy: { name: 'asc' } })).map(publicUser) }); } catch (e) { next(e); } });
router.post('/', async (req, res, next) => { try { res.status(201).json({ success: true, data: publicUser(await createUser(req.body)) }); } catch (e) { e.status = 400; next(e); } });
router.put('/:id', async (req, res, next) => { try {
  const data = {};
  if (req.body.name !== undefined) data.name = String(req.body.name).trim();
  if (['admin', 'operator', 'viewer'].includes(req.body.role)) data.role = req.body.role;
  if (typeof req.body.isActive === 'boolean') data.isActive = req.body.isActive;
  if (req.body.password) Object.assign(data, { passwordHash: await hashPassword(req.body.password), mustChangePassword: true });
  if (req.params.id === req.user.sub && (data.isActive === false || (data.role && data.role !== 'admin'))) return res.status(400).json({ success: false, error: 'Você não pode remover seu próprio acesso administrativo' });
  res.json({ success: true, data: publicUser(await prisma.user.update({ where: { id: req.params.id }, data })) });
} catch (e) { e.status = 400; next(e); } });
router.delete('/:id', async (req, res, next) => { try {
  if (req.params.id === req.user.sub) return res.status(400).json({ success: false, error: 'Você não pode excluir seu próprio usuário' });
  await prisma.user.delete({ where: { id: req.params.id } }); res.json({ success: true });
} catch (e) { next(e); } });
export default router;
