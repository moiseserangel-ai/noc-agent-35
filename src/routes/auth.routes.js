import { Router } from 'express';
import config from '../config/index.js';
import { authMiddleware, generateToken } from '../middleware/auth.middleware.js';
import prisma from '../database/client.js';
import { decrypt } from '../utils/crypto.js';
import { ensureAdminUser, publicUser, verifyPassword, hashPassword } from '../services/user.service.js';

const router = Router();

const attempts = new Map();
router.post('/login', async (req, res) => {
  const client = req.ip;
  const now = Date.now();
  const entry = attempts.get(client) || { count: 0, since: now };
  if (now - entry.since > 15 * 60_000) { entry.count = 0; entry.since = now; }
  if (entry.count >= 5) return res.status(429).json({ success: false, error: 'Muitas tentativas. Aguarde 15 minutos.' });
  const { password } = req.body;
  const username = String(req.body.username || 'admin').trim().toLowerCase();
  if (!password) return res.status(400).json({ success: false, error: 'Informe a senha' });
  const stored = await prisma.settings.findUnique({ where: { key: 'dashboard_password' } });
  const activePassword = stored?.value ? (stored.encrypted ? decrypt(stored.value) : stored.value) : config.dashboardPassword;
  await ensureAdminUser(activePassword);
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user?.isActive || !(await verifyPassword(password, user.passwordHash))) {
    entry.count += 1;
    attempts.set(client, entry);
    return res.status(401).json({ success: false, error: 'Invalid password' });
  }
  attempts.delete(client);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const safe = publicUser(user);
  res.json({ success: true, token: generateToken(safe), user: safe });
});

router.get('/verify', authMiddleware, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
  if (!user?.isActive) return res.status(401).json({ success: false, error: 'Usuário inativo' });
  res.json({ success: true, user: publicUser(user) });
});

// Sliding session: an authenticated dashboard can renew its short-lived token
// without asking the administrator to log in again.
router.post('/refresh', authMiddleware, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
  if (!user?.isActive) return res.status(401).json({ success: false, error: 'Usuário inativo' });
  res.json({ success: true, token: generateToken(user), user: publicUser(user) });
});

router.post('/change-password', authMiddleware, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
  if (!user || !(await verifyPassword(req.body.currentPassword, user.passwordHash))) return res.status(400).json({ success: false, error: 'Senha atual incorreta' });
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(req.body.newPassword), mustChangePassword: false } });
  res.json({ success: true });
});

export default router;
