import crypto from 'node:crypto';
import { promisify } from 'node:util';
import prisma from '../database/client.js';

const scrypt = promisify(crypto.scrypt);
const ROLES = ['admin', 'operator', 'viewer'];

export async function hashPassword(password, enforcePolicy = true) {
  const value = String(password || '');
  if (enforcePolicy) validatePassword(value);
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scrypt(value, salt, 64);
  return `scrypt:${salt}:${Buffer.from(derived).toString('hex')}`;
}

export function validatePassword(value) {
  const password=String(value||'');
  if(password.length<10||!/[a-z]/.test(password)||!/[A-Z]/.test(password)||!/[0-9]/.test(password)||!/[^A-Za-z0-9]/.test(password)) throw new Error('A senha deve ter no mínimo 10 caracteres, com maiúscula, minúscula, número e símbolo');
  return true;
}

export async function verifyPassword(password, encoded) {
  const [algorithm, salt, expectedHex] = String(encoded || '').split(':');
  if (algorithm !== 'scrypt' || !salt || !expectedHex) return false;
  const derived = Buffer.from(await scrypt(String(password), salt, 64));
  const expected = Buffer.from(expectedHex, 'hex');
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

export function publicUser(user) {
  const { passwordHash, twoFactorSecret, ...safe } = user;
  return safe;
}

export async function createUser(data) {
  const username = String(data.username || '').trim().toLowerCase();
  const name = String(data.name || '').trim();
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new Error('Usuário inválido: use 3-40 letras, números, ponto, hífen ou sublinhado');
  if (!name) throw new Error('Informe o nome');
  if (!ROLES.includes(data.role)) throw new Error('Perfil inválido');
  return prisma.user.create({ data: { username, name, role: data.role, passwordHash: await hashPassword(data.password), mustChangePassword: data.mustChangePassword !== false } });
}

export async function ensureAdminUser(password) {
  if (await prisma.user.count()) return;
  await prisma.user.create({ data: { username: 'admin', name: 'Administrador', role: 'admin', passwordHash: await hashPassword(password, false), mustChangePassword: true } });
}
