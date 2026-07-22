import { PrismaClient } from '@prisma/client';
import { mkdir, readdir, stat, copyFile, rename, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import prisma from '../database/client.js';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const DATABASE_FILE = join(PROJECT_ROOT, 'prisma/data/noc-agent.db');
export const BACKUP_DIR = join(PROJECT_ROOT, 'backups');
const NAME_PATTERN = /^noc-agent-(manual|automatic|pre-restore)-\d{8}T\d{6}Z\.db$/;
const stamp = date => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export async function ensureBackupDirectory() { await mkdir(BACKUP_DIR, { recursive: true, mode: 0o700 }); }
export function safeBackupPath(filename) {
  if (!NAME_PATTERN.test(String(filename))) throw Object.assign(new Error('Nome de backup inválido'), { statusCode: 400 });
  return join(BACKUP_DIR, filename);
}

export async function verifyBackup(path) {
  const client = new PrismaClient({ datasources: { db: { url: `file:${path}` } } });
  try {
    const result = await client.$queryRawUnsafe('PRAGMA integrity_check');
    const values = result.flatMap(row => Object.values(row));
    if (!values.some(value => String(value).toLowerCase() === 'ok')) throw new Error(`Falha de integridade: ${values.join(', ')}`);
    return true;
  } finally { await client.$disconnect(); }
}

export async function listBackups() {
  await ensureBackupDirectory();
  const files = await readdir(BACKUP_DIR);
  const items = [];
  for (const filename of files.filter(name => NAME_PATTERN.test(name))) {
    const info = await stat(join(BACKUP_DIR, filename));
    items.push({ filename, type: filename.match(NAME_PATTERN)[1], size: info.size, createdAt: info.mtime });
  }
  return items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export async function enforceRetention(retention = 7) {
  const automatic = (await listBackups()).filter(item => item.type === 'automatic');
  for (const item of automatic.slice(Math.max(Number(retention) || 7, 1))) await unlink(safeBackupPath(item.filename));
}

export async function createBackup(type = 'manual', retention = 7) {
  if (!['manual', 'automatic', 'pre-restore'].includes(type)) throw new Error('Tipo de backup inválido');
  await ensureBackupDirectory();
  const filename = `noc-agent-${type}-${stamp(new Date())}.db`;
  const path = safeBackupPath(filename);
  await prisma.$executeRawUnsafe(`VACUUM INTO '${path.replaceAll("'", "''")}'`);
  await verifyBackup(path);
  if (type === 'automatic') await enforceRetention(retention);
  const info = await stat(path);
  return { filename, type, size: info.size, createdAt: info.mtime, integrity: 'ok' };
}

export async function restoreBackup(filename) {
  const source = safeBackupPath(filename);
  await verifyBackup(source);
  const safety = await createBackup('pre-restore');
  const temporary = `${DATABASE_FILE}.restore-tmp`;
  await prisma.$disconnect();
  await copyFile(source, temporary);
  await rename(temporary, DATABASE_FILE);
  await Promise.all([unlink(`${DATABASE_FILE}-wal`).catch(() => {}), unlink(`${DATABASE_FILE}-shm`).catch(() => {})]);
  return safety;
}

export async function getBackupConfig() {
  const rows = await prisma.settings.findMany({ where: { key: { in: ['backup_enabled', 'backup_hour', 'backup_retention'] } } });
  const values = Object.fromEntries(rows.map(row => [row.key, row.value]));
  return { enabled: values.backup_enabled !== 'false', hour: Math.min(Math.max(Number(values.backup_hour) || 2, 0), 23), retention: Math.min(Math.max(Number(values.backup_retention) || 7, 1), 90) };
}

export async function runAutomaticBackup() {
  const cfg = await getBackupConfig();
  if (!cfg.enabled || new Date().getHours() !== cfg.hour) return null;
  const today = stamp(new Date()).slice(0, 8);
  if ((await listBackups()).some(item => item.type === 'automatic' && item.filename.includes(today))) return null;
  return createBackup('automatic', cfg.retention);
}
