import { Client } from 'ssh2';
import { getDeviceDecrypted } from '../services/device.service.js';
import logger from '../utils/logger.js';
import { isRemediationApproved } from '../security/execution-context.js';

const BLOCKED_COMMANDS_LINUX = [
  'rm -rf /',
  'mkfs',
  'dd if=',
  ':(){:|:&};:',
  '> /dev/sda',
  'chmod -R 777 /',
  'mv /* /dev/null',
];

const REBOOT_COMMANDS = ['shutdown', 'reboot', 'init 0', 'init 6', 'poweroff', 'halt'];

function isBlockedCommand(command) {
  const cmd = command.toLowerCase().trim();
  if (BLOCKED_COMMANDS_LINUX.some(blocked => cmd.includes(blocked))) return true;
  if (REBOOT_COMMANDS.some(rc => cmd.startsWith(rc) || cmd.includes(` ${rc}`))) return true;
  return false;
}

const READ_ONLY_LINUX = /^(uptime|free\b|df\b|du\b|top\b|ps\b|ss\b|netstat\b|ip\s+(addr|address|route|link|neigh)\b|ping\b|traceroute\b|journalctl\b|dmesg\b|cat\s+\/((var\/log)|(proc)|(sys))\/|tail\b|head\b|grep\b|systemctl\s+(status|list-units|is-active|is-enabled|show)\b|ls\b|findmnt\b|mount\s*$|hostname\b|uname\b|who\b|w\b)/i;

export async function sshLinuxExec({ deviceId, command }) {
  if (!isRemediationApproved() && !READ_ONLY_LINUX.test(String(command).trim())) {
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
  if (device.type !== 'linux') {
    return { success: false, output: 'Dispositivo não é Linux' };
  }

  logger.info(`SSH Linux: ${device.hostname} → ${command}`);

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

        stream.on('close', (code) => {
          clearTimeout(timeout);
          conn.end();
          const result = (output + (errorOutput ? `\nSTDERR: ${errorOutput}` : '')).trim();
          resolve({
            success: code === 0 || code === null,
            output: result || '(sem saída)',
            exitCode: code,
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
    });
  });
}

export const sshLinuxToolDefinition = {
  name: 'ssh_linux_exec',
  description: 'Executa um comando em um servidor Linux via SSH. Use comandos como systemctl status, df -h, free -m, top -bn1, netstat -tlnp, ping, traceroute, etc.',
  input_schema: {
    type: 'object',
    properties: {
      deviceId: {
        type: 'string',
        description: 'ID do servidor Linux no banco de dados',
      },
      command: {
        type: 'string',
        description: 'Comando Linux a ser executado (ex: systemctl status nginx, df -h)',
      },
    },
    required: ['deviceId', 'command'],
  },
};
