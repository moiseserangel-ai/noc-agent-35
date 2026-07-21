import { Router } from 'express';
import config from '../config/index.js';
import crypto from 'node:crypto';
import { authMiddleware, generateToken } from '../middleware/auth.middleware.js';
import prisma from '../database/client.js';
import { decrypt } from '../utils/crypto.js';

const router = Router();

const attempts = new Map();
router.post('/login', async (req, res) => {
  const client = req.ip;
  const now = Date.now();
  const entry = attempts.get(client) || { count: 0, since: now };
  if (now - entry.since > 15 * 60_000) { entry.count = 0; entry.since = now; }
  if (entry.count >= 5) return res.status(429).json({ success: false, error: 'Muitas tentativas. Aguarde 15 minutos.' });
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ success: false, error: 'Password required' });
  }
  const stored = await prisma.settings.findUnique({ where: { key: 'dashboard_password' } });
  const activePassword = stored?.value ? (stored.encrypted ? decrypt(stored.value) : stored.value) : config.dashboardPassword;
  const supplied = Buffer.from(String(password));
  const expected = Buffer.from(activePassword);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    entry.count += 1;
    attempts.set(client, entry);
    return res.status(401).json({ success: false, error: 'Invalid password' });
  }
  attempts.delete(client);
  const token = generateToken();
  res.json({ success: true, token });
});

router.get('/verify', authMiddleware, (req, res) => {
  res.json({ success: true, message: 'Token is valid' });
});

// Sliding session: an authenticated dashboard can renew its short-lived token
// without asking the administrator to log in again.
router.post('/refresh', authMiddleware, (_req, res) => {
  res.json({ success: true, token: generateToken() });
});

export default router;
