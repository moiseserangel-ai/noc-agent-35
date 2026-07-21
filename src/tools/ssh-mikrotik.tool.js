import { Client } from 'ssh2';
import { getDeviceDecrypted } from '../services/device.service.js';
import logger from '../utils/logger.js';
import { isRemediationApproved } from '../security/execution-context.js';

const BLOCKED_COMMANDS_MIKROTIK = [
  '/system reset',
  '/system routerboard upgrade',
  '/file remove',
  '/system package downgrade',
  'format',
];

function isBlockedCommand(command) {
  const cmd = command.toLowerCase().trim();
  return BLOCKED_COMMANDS_MIKROTIK.some(blocked => cmd.includes(blocked));
}

export async function sshMikrotikExec({ deviceId, command }) {
  const normalized = String(command).toLowerCase().trim();
  const readOnly = normalized.startsWith('/ping ') || normalized.startsWith('/tool traceroute ') || /\b(print|monitor|export)\b/.test(normalized);
  if (!isRemediationApproved() && !readOnly) {
    return { success: false, output: 'Comando de alteração bloqueado: diagnóstico permite somente leitura.' };
  }
  if (isBlockedCommand(command)) {
    return {
      success: false,
      output: `⛔ Comando bloqueado por segurança: ${command}`,
    };
  }

  const device = await getDeviceDecrypted(deviceId);
  if (!device) {
    return { success: false, output: 'Dispositivo não encontrado' };
  }
  if (device.type !== 'mikrotik') {
    return { success: false, output: 'Dispositivo não é MikroTik' };
  }

  logger.info(`SSH MikroTik: ${device.hostname} → ${command}`);

  return new Promise((resolve) => {
    const conn = new Client();
    let output = '';
    let errorOutput = '';

    const timeout = setTimeout(() => {
      conn.end();
      resolve({
        success: false,
        output: `Timeout: comando demorou mais de 30s em ${device.hostname}`,
      });
    }, 30000);

    conn.on('ready', () => {
      conn.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timeout);
          conn.end();
          resolve({ success: false, output: `Erro ao executar: ${err.message}` });
          return;
        }

        stream.on('data', (data) => { output += data.toString(); });
        stream.stderr.on('data', (data) => { errorOutput += data.toString(); });

        stream.on('close', () => {
          clearTimeout(timeout);
          conn.end();
          const result = (output + errorOutput).trim();
          resolve({
            success: true,
            output: result || '(sem saída)',
            device: { name: device.name, hostname: device.hostname },
          });
        });
      });
    });

    conn.on('error', (err) => {
      clearTimeout(timeout);
      resolve({ success: false, output: `Erro de conexão SSH: ${err.message}` });
    });

    conn.connect({
      host: device.hostname,
      port: device.port,
      username: device.username,
      password: device.password,
      readyTimeout: 10000,
      algorithms: {
        kex: [
          'diffie-hellman-group14-sha256',
          'diffie-hellman-group14-sha1',
          'diffie-hellman-group1-sha1',
        ],
      },
    });
  });
}

export const sshMikrotikToolDefinition = {
  name: 'ssh_mikrotik_exec',
  description: 'Executa um comando RouterOS em um dispositivo MikroTik via SSH. Use comandos como /ip address print, /interface print, /ping, /system resource print, etc.',
  input_schema: {
    type: 'object',
    properties: {
      deviceId: {
        type: 'string',
        description: 'ID do dispositivo MikroTik no banco de dados',
      },
      command: {
        type: 'string',
        description: 'Comando RouterOS a ser executado (ex: /ip address print, /interface print)',
      },
    },
    required: ['deviceId', 'command'],
  },
};
