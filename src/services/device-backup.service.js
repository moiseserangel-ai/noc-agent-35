import crypto from 'node:crypto';
import prisma from '../database/client.js';
import logger from '../utils/logger.js';
import { encrypt, decrypt } from '../utils/crypto.js';
import { sshMikrotikExec } from '../tools/ssh-mikrotik.tool.js';
import { sshHuaweiVrpExec } from '../tools/ssh-huawei-vrp.tool.js';
import { getNotificationConfig, sendTelegramMessage } from './notification.service.js';
import { sendToAdmin } from './evolution.service.js';
import { logAudit } from './audit.service.js';

const running = new Set();
export const SUPPORTED_BACKUP_TYPES = ['mikrotik', 'huawei_vrp'];

const clamp = (value, minimum, maximum, fallback) => {
  const numeric = Number(value);
  return Math.min(Math.max(Number.isFinite(numeric) ? numeric : fallback, minimum), maximum);
};

export function nextDeviceBackupAt(policy, from = new Date()) {
  const next = new Date(from);
  next.setMinutes(0, 0, 0);
  next.setHours(clamp(policy.hour, 0, 23, 2));
  if (policy.frequency === 'weekly') {
    const target = clamp(policy.weekday, 0, 6, 0);
    let days = (target - next.getDay() + 7) % 7;
    if (days === 0 && next <= from) days = 7;
    next.setDate(next.getDate() + days);
  } else if (next <= from) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

async function captureMikrotik(deviceId) {
  let result = await sshMikrotikExec({ deviceId, command: '/export hide-sensitive' });
  if (!result.success || /bad command|syntax error|expected end/i.test(result.output)) {
    result = await sshMikrotikExec({ deviceId, command: '/export show-sensitive=no' });
  }
  return result;
}

async function captureConfiguration(device) {
  if (device.type === 'mikrotik') return captureMikrotik(device.id);
  if (device.type === 'huawei_vrp') return sshHuaweiVrpExec({ deviceId: device.id, command: 'display current-configuration' });
  throw new Error('Backup disponível somente para MikroTik e Huawei VRP');
}

async function enforceDeviceRetention(deviceId, retention) {
  const old = await prisma.deviceConfigBackup.findMany({
    where: { deviceId, status: 'success' },
    orderBy: { createdAt: 'desc' },
    skip: clamp(retention, 1, 365, 14),
    select: { id: true },
  });
  if (old.length) await prisma.deviceConfigBackup.deleteMany({ where: { id: { in: old.map(item => item.id) } } });
}

async function notifyFailure(device, error) {
  try {
    const cfg = await getNotificationConfig();
    if (!cfg.enabled) return;
    const text = `⚠️ Falha no backup de equipamento\nEquipamento: ${device.name}\nEndereço: ${device.hostname}\nErro: ${error}`;
    for (const chatId of cfg.telegramChats) await sendTelegramMessage(chatId, text, cfg.telegramToken).catch(() => {});
    await sendToAdmin(text).catch(() => {});
  } catch {}
}

export async function runDeviceBackup(deviceId, { type = 'manual', username = 'system' } = {}) {
  if (running.has(deviceId)) throw Object.assign(new Error('Já existe um backup em execução para este equipamento'), { statusCode: 409 });
  running.add(deviceId);
  let device;
  try {
    device = await prisma.device.findUnique({ where: { id: deviceId } });
    if (!device || !device.isActive) throw Object.assign(new Error('Equipamento não encontrado ou inativo'), { statusCode: 404 });
    if (!SUPPORTED_BACKUP_TYPES.includes(device.type)) throw Object.assign(new Error('Backup disponível somente para MikroTik e Huawei VRP'), { statusCode: 400 });
    const result = await captureConfiguration(device);
    if (!result.success) throw new Error(result.output || 'Falha ao capturar configuração');
    const content = String(result.output || '').trim();
    if (content.length < 40) throw new Error('A configuração retornada está vazia ou incompleta');
    const sha256 = crypto.createHash('sha256').update(content).digest('hex');
    const snapshot = await prisma.deviceConfigBackup.create({
      data: {
        deviceId,
        type,
        status: 'success',
        content: encrypt(content),
        sha256,
        size: Buffer.byteLength(content, 'utf8'),
        deviceName: device.name,
        hostname: device.hostname,
        deviceType: device.type,
        manufacturer: device.manufacturer,
        model: device.model,
        osVersion: device.osVersion,
        createdBy: username,
      },
    });
    const policy = await prisma.deviceBackupPolicy.findUnique({ where: { deviceId } });
    await enforceDeviceRetention(deviceId, policy?.retention || 14);
    if (type === 'automatic' && policy) {
      await prisma.deviceBackupPolicy.update({
        where: { deviceId },
        data: { lastRunAt: new Date(), lastStatus: 'success', lastError: null, nextRunAt: nextDeviceBackupAt(policy, new Date(Date.now() + 60_000)) },
      });
    }
    await logAudit({ username, displayName: username === 'system' ? 'Agendador de backup' : username, role: username === 'system' ? 'system' : 'admin', action: 'create', resource: 'device_backup', resourceId: snapshot.id, status: 'success', details: { deviceId, deviceName: device.name, type, sha256, size: snapshot.size } });
    return { ...snapshot, content: undefined };
  } catch (error) {
    if (device) {
      const failed = await prisma.deviceConfigBackup.create({
        data: { deviceId, type, status: 'failed', deviceName: device.name, hostname: device.hostname, deviceType: device.type, manufacturer: device.manufacturer, model: device.model, osVersion: device.osVersion, error: error.message.slice(0, 2000), createdBy: username },
      }).catch(() => null);
      const policy = await prisma.deviceBackupPolicy.findUnique({ where: { deviceId } });
      if (type === 'automatic' && policy) {
        await prisma.deviceBackupPolicy.update({ where: { deviceId }, data: { lastRunAt: new Date(), lastStatus: 'failed', lastError: error.message.slice(0, 1000), nextRunAt: nextDeviceBackupAt(policy, new Date(Date.now() + 60_000)) } });
      }
      await notifyFailure(device, error.message);
      await logAudit({ username, displayName: username === 'system' ? 'Agendador de backup' : username, role: username === 'system' ? 'system' : 'admin', action: 'create', resource: 'device_backup', resourceId: failed?.id, status: 'failure', details: { deviceId, deviceName: device.name, type, error: error.message } });
    }
    throw error;
  } finally {
    running.delete(deviceId);
  }
}

export async function saveDeviceBackupPolicy(deviceId, input) {
  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!device || !SUPPORTED_BACKUP_TYPES.includes(device.type)) throw Object.assign(new Error('Equipamento MikroTik ou Huawei não encontrado'), { statusCode: 404 });
  const data = {
    enabled: input.enabled === true || input.enabled === 'true',
    frequency: input.frequency === 'weekly' ? 'weekly' : 'daily',
    hour: clamp(input.hour, 0, 23, 2),
    weekday: clamp(input.weekday, 0, 6, 0),
    retention: clamp(input.retention, 1, 365, 14),
  };
  data.nextRunAt = data.enabled ? nextDeviceBackupAt(data) : null;
  return prisma.deviceBackupPolicy.upsert({ where: { deviceId }, update: data, create: { deviceId, ...data } });
}

export async function runDeviceBackupScheduler() {
  const due = await prisma.deviceBackupPolicy.findMany({
    where: { enabled: true, nextRunAt: { lte: new Date() }, device: { isActive: true, type: { in: SUPPORTED_BACKUP_TYPES } } },
    select: { deviceId: true },
  });
  for (const item of due) {
    if (running.has(item.deviceId)) continue;
    await runDeviceBackup(item.deviceId, { type: 'automatic', username: 'system' }).catch(error => logger.error(`Device backup ${item.deviceId}: ${error.message}`));
  }
}

export function decryptSnapshot(snapshot) {
  if (!snapshot?.content) throw Object.assign(new Error('Este backup não possui conteúdo disponível'), { statusCode: 404 });
  const content = decrypt(snapshot.content);
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  if (hash !== snapshot.sha256) throw new Error('Falha na verificação de integridade do backup');
  return content;
}

export function compareConfigurations(before, after) {
  const a = String(before).split(/\r?\n/);
  const b = String(after).split(/\r?\n/);
  const aSet = new Set(a);
  const bSet = new Set(b);
  const removed = a.filter(line => line.trim() && !bSet.has(line));
  const added = b.filter(line => line.trim() && !aSet.has(line));
  return { added: added.slice(0, 2000), removed: removed.slice(0, 2000), addedCount: added.length, removedCount: removed.length, unchangedCount: b.filter(line => aSet.has(line)).length };
}
