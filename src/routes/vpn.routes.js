import { Router } from 'express';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import prisma from '../database/client.js';
import { encrypt, decrypt } from '../utils/crypto.js';

const router = Router();
const execFileAsync = promisify(execFile);
const keyMap = { server: 'vpn_l2tp_server', username: 'vpn_l2tp_username', password: 'vpn_l2tp_password', psk: 'vpn_l2tp_psk' };
const validHost = value => /^(?=.{1,253}$)([a-zA-Z0-9][a-zA-Z0-9.-]*|\d{1,3}(\.\d{1,3}){3})$/.test(value);
const validUser = value => /^[a-zA-Z0-9_.@\\-]{1,128}$/.test(value);
const validSecret = value => /^[a-zA-Z0-9_.@#+=:\\-]{8,256}$/.test(value);

async function loadProfile() {
  const rows = await prisma.settings.findMany({ where: { key: { in: Object.values(keyMap) } } });
  const values = Object.fromEntries(rows.map(row => [row.key, row.encrypted ? decrypt(row.value) : row.value]));
  return Object.fromEntries(Object.entries(keyMap).map(([name, key]) => [name, values[key] || '']));
}

router.get('/', async (_req, res, next) => {
  try {
    const profile = await loadProfile();
    let status = 'desconectado';
    try { const { stdout } = await execFileAsync('sudo', ['/usr/local/sbin/noc-l2tp', 'status'], { timeout: 5000 }); status = stdout.trim(); } catch {}
    res.json({ success: true, data: { server: profile.server, username: profile.username, password: profile.password ? '••••••••' : '', psk: profile.psk ? '••••••••' : '', status } });
  } catch (err) { next(err); }
});

router.put('/', async (req, res, next) => {
  try {
    const { server, username, password, psk } = req.body;
    if (!validHost(String(server || '')) || !validUser(String(username || ''))) return res.status(400).json({ success: false, error: 'Servidor ou usuário inválido' });
    const current = await loadProfile();
    const profile = { server, username, password: password && password !== '••••••••' ? password : current.password, psk: psk && psk !== '••••••••' ? psk : current.psk };
    if (!validSecret(profile.password) || !validSecret(profile.psk)) return res.status(400).json({ success: false, error: 'Senha/PSK devem ter 8–256 caracteres seguros' });
    for (const [name, key] of Object.entries(keyMap)) await prisma.settings.upsert({ where: { key }, update: { value: encrypt(profile[name]), encrypted: true }, create: { key, value: encrypt(profile[name]), encrypted: true } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.post('/connect', async (_req, res, next) => {
  try {
    const p = await loadProfile();
    if (!p.server || !p.username || !p.password || !p.psk) return res.status(400).json({ success: false, error: 'Configure o perfil primeiro' });
    const { stdout } = await execFileAsync('sudo', ['/usr/local/sbin/noc-l2tp', 'connect', p.server, p.username, p.password, p.psk], { timeout: 30000 });
    res.json({ success: true, message: stdout.trim() });
  } catch (err) { next(err); }
});

router.post('/disconnect', async (_req, res, next) => {
  try { const { stdout } = await execFileAsync('sudo', ['/usr/local/sbin/noc-l2tp', 'disconnect'], { timeout: 15000 }); res.json({ success: true, message: stdout.trim() }); }
  catch (err) { next(err); }
});

export default router;
