import { Client } from 'ssh2';
import prisma from '../database/client.js';
import { getDeviceDecrypted } from './device.service.js';
import { classifyCliCommand } from './cli.service.js';
import { logAudit } from './audit.service.js';
import logger from '../utils/logger.js';

const sessions = new Map();
const MAX_USER_SESSIONS = 5;
const MAX_DEVICE_SESSIONS = 2;
const BLOCKED = [
  /\/system\s+reset/i,
  /\/system\s+routerboard\s+upgrade/i,
  /\/system\s+package\s+downgrade/i,
  /\breset\s+saved-configuration\b/i,
  /\bstartup\s+system-software\b/i,
  /(^|\s)(?:reboot|shutdown|poweroff|halt)(\s|$)/i,
  /\bformat\b/i,
  /\bmkfs(?:\.|\s)/i,
  /\bdd\s+if=/i,
  /\brm\s+-[^\n]*r[^\n]*f[^\n]*\s+\/(?:\s|$)/i,
  /:\(\)\s*\{\s*:\|:&\s*\};:/,
];

export function isBlockedInteractiveCommand(command) {
  const value = String(command || '').trim();
  return BLOCKED.some(pattern => pattern.test(value));
}

const socketAudit = (socket, action, resourceId, status, details) => logAudit({
  userId: socket.user.sub,
  username: socket.user.username,
  displayName: socket.user.name,
  role: socket.user.role,
  ipAddress: socket.handshake.address,
  userAgent: socket.handshake.headers['user-agent'],
  action,
  resource: 'cli_interactive',
  resourceId,
  status,
  details,
});

async function closeSession(socket, reason = 'user') {
  const active = sessions.get(socket.id);
  if (!active) return;
  sessions.delete(socket.id);
  try { active.stream?.end(); } catch {}
  try { active.connection?.end(); } catch {}
  if (active.sessionId) {
    await prisma.cliSession.updateMany({
      where: { id: active.sessionId, status: 'active' },
      data: { status: reason === 'timeout' ? 'expired' : 'closed', endedAt: new Date(), lastActiveAt: new Date() },
    }).catch(() => {});
    await socketAudit(socket, 'cli_interactive_close', active.sessionId, 'success', {
      deviceId: active.deviceId,
      deviceName: active.deviceName,
      reason,
    });
  }
  socket.emit('cli:interactive:status', { status: 'closed', reason });
}

async function recordCommand(socket, active, command, status = 'success') {
  const value = String(command || '').trim();
  if (!value || !active.sessionId) return;
  const policy = classifyCliCommand(active.deviceType, value);
  const commandType = policy.valid ? policy.type : 'change';
  await prisma.cliCommand.create({
    data: {
      sessionId: active.sessionId,
      command: value.slice(0, 8000),
      commandType,
      status,
      output: status === 'blocked' ? 'Bloqueado pela política de segurança do terminal interativo.' : 'Enviado em sessão SSH interativa.',
      durationMs: 0,
    },
  }).catch(error => logger.error(`Interactive CLI command audit failed: ${error.message}`));
  await prisma.cliSession.update({ where: { id: active.sessionId }, data: { lastActiveAt: new Date() } }).catch(() => {});
  await socketAudit(socket, status === 'blocked' ? 'cli_interactive_blocked' : `cli_interactive_${commandType}`, active.deviceId, status === 'blocked' ? 'failure' : 'success', {
    cliSessionId: active.sessionId,
    deviceName: active.deviceName,
    command: value.slice(0, 2000),
  });
}

export function registerInteractiveCli(socket) {
  socket.on('cli:interactive:connect', async (payload = {}, acknowledge = () => {}) => {
    if (socket.user.role !== 'admin') return acknowledge({ success: false, error: 'Terminal interativo disponível somente para administradores.' });
    try {
      await closeSession(socket, 'replaced');
      const device = await getDeviceDecrypted(payload.deviceId);
      if (!device?.isActive || !['mikrotik', 'huawei_vrp', 'cisco_ios', 'juniper_junos', 'fortigate_fortios', 'ubiquiti_edgeos', 'datacom_dmos', 'nokia_sros', 'linux'].includes(device.type)) {
        return acknowledge({ success: false, error: 'Equipamento não encontrado, inativo ou sem suporte.' });
      }
      const userSessions = [...sessions.values()].filter(item => item.userId === socket.user.sub);
      if (userSessions.length >= MAX_USER_SESSIONS) {
        return acknowledge({ success: false, error: `Limite de ${MAX_USER_SESSIONS} sessões interativas simultâneas atingido.` });
      }
      if (userSessions.filter(item => item.deviceId === device.id).length >= MAX_DEVICE_SESSIONS) {
        return acknowledge({ success: false, error: `Limite de ${MAX_DEVICE_SESSIONS} sessões simultâneas neste equipamento atingido.` });
      }

      const connection = new Client();
      const active = {
        userId: socket.user.sub,
        connection,
        stream: null,
        sessionId: null,
        deviceId: device.id,
        deviceName: device.name,
        deviceType: device.type,
        commandBuffer: '',
        bufferReliable: true,
        idleTimer: null,
      };
      sessions.set(socket.id, active);
      const resetIdle = () => {
        clearTimeout(active.idleTimer);
        active.idleTimer = setTimeout(() => closeSession(socket, 'timeout'), 30 * 60 * 1000);
        active.idleTimer.unref?.();
      };
      resetIdle();

      connection.on('ready', () => {
        connection.shell({
          term: 'xterm-256color',
          cols: Math.max(40, Math.min(Number(payload.cols) || 120, 300)),
          rows: Math.max(12, Math.min(Number(payload.rows) || 32, 100)),
        }, async (error, stream) => {
          if (error) {
            sessions.delete(socket.id);
            connection.end();
            return acknowledge({ success: false, error: `Falha ao abrir PTY: ${error.message}` });
          }
          active.stream = stream;
          const session = await prisma.cliSession.create({
            data: {
              userId: socket.user.sub,
              username: socket.user.username,
              userRole: socket.user.role,
              deviceId: device.id,
              deviceName: device.name,
              deviceType: device.type,
              hostname: device.hostname,
              mode: 'interactive',
              ipAddress: socket.handshake.address || null,
              userAgent: socket.handshake.headers['user-agent']?.slice(0, 300) || null,
            },
          });
          active.sessionId = session.id;
          stream.on('data', data => {
            resetIdle();
            socket.emit('cli:interactive:output', { data: data.toString('utf8') });
          });
          stream.stderr.on('data', data => socket.emit('cli:interactive:output', { data: data.toString('utf8') }));
          stream.on('close', () => closeSession(socket, 'remote'));
          await socketAudit(socket, 'cli_interactive_open', session.id, 'success', { deviceId: device.id, deviceName: device.name, hostname: device.hostname });
          acknowledge({ success: true, session: { id: session.id, deviceId: device.id, deviceName: device.name, deviceType: device.type, hostname: device.hostname, mode: 'interactive' } });
          socket.emit('cli:interactive:status', { status: 'connected', sessionId: session.id });
        });
      });
      connection.on('error', async error => {
        logger.error(`Interactive CLI SSH error (${device.name}): ${error.message}`);
        if (!active.sessionId) acknowledge({ success: false, error: `Erro SSH: ${error.message}` });
        socket.emit('cli:interactive:error', { error: error.message });
        await closeSession(socket, 'error');
      });
      connection.connect({
        host: device.hostname,
        port: device.port,
        username: device.username,
        password: device.password,
        readyTimeout: 12000,
        algorithms: device.type === 'mikrotik' ? {
          kex: ['curve25519-sha256', 'ecdh-sha2-nistp256', 'diffie-hellman-group14-sha256', 'diffie-hellman-group14-sha1', 'diffie-hellman-group1-sha1'],
        } : undefined,
      });
    } catch (error) {
      sessions.delete(socket.id);
      acknowledge({ success: false, error: error.message });
    }
  });

  socket.on('cli:interactive:input', async ({ data } = {}) => {
    const active = sessions.get(socket.id);
    if (!active?.stream || typeof data !== 'string' || data.length > 2048) return;
    for (let index = 0; index < data.length; index += 1) {
      const character = data[index];
      if (character === '\r' || character === '\n') {
        const command = active.commandBuffer;
        if (active.bufferReliable && isBlockedInteractiveCommand(command)) {
          active.stream.write('\x15');
          socket.emit('cli:interactive:output', { data: `\r\n\u001b[31m⛔ Comando bloqueado pela política de segurança.\u001b[0m\r\n` });
          await recordCommand(socket, active, command, 'blocked');
        } else {
          active.stream.write(character);
          await recordCommand(socket, active, command);
        }
        active.commandBuffer = '';
        active.bufferReliable = true;
      } else {
        active.stream.write(character);
        if (character === '\x03' || character === '\x15') {
          active.commandBuffer = '';
          active.bufferReliable = true;
        } else if (character === '\x7f' || character === '\b') {
          active.commandBuffer = active.commandBuffer.slice(0, -1);
        } else if (character === '\x1b') {
          active.bufferReliable = false;
        } else if (character >= ' ' && character !== '\x7f' && active.bufferReliable) {
          active.commandBuffer += character;
        }
      }
    }
  });

  socket.on('cli:interactive:resize', ({ cols, rows } = {}) => {
    const active = sessions.get(socket.id);
    if (!active?.stream) return;
    active.stream.setWindow(
      Math.max(12, Math.min(Number(rows) || 32, 100)),
      Math.max(40, Math.min(Number(cols) || 120, 300)),
      0,
      0
    );
  });

  socket.on('cli:interactive:disconnect', () => closeSession(socket, 'user'));
  socket.on('disconnect', () => closeSession(socket, 'socket'));
}
