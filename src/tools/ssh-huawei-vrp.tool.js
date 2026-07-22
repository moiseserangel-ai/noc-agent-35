import { Client } from 'ssh2';
import { getDeviceDecrypted } from '../services/device.service.js';
import logger from '../utils/logger.js';
import { getExecutionContext, isRemediationApproved } from '../security/execution-context.js';
import { formatChangeMarker, normalizeChangeComment, recordDeviceChange } from '../services/device-change.service.js';

const READ_ONLY = /^(display\b|ping\b|tracert\b|screen-length\s+0\s+temporary\b)/i;
const BLOCKED = [
  /\breboot\b/i,
  /\breset\s+saved-configuration\b/i,
  /\bformat\b/i,
  /\bstartup\s+system-software\b/i,
  /\bdelete\s+.*\.(cfg|zip|cc)$/i,
];

export function validateHuaweiCommands(command, approved = isRemediationApproved()) {
  const commands = String(command || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!commands.length) return { allowed: false, reason: 'Nenhum comando informado', commands: [] };
  if (commands.some(line => BLOCKED.some(pattern => pattern.test(line)))) return { allowed: false, reason: 'Comando destrutivo bloqueado pela política Huawei', commands };
  if (!approved && commands.some(line => !READ_ONLY.test(line))) return { allowed: false, reason: 'Comando de alteração bloqueado: diagnóstico permite somente display, ping e tracert.', commands };
  return { allowed: true, commands };
}

export async function sshHuaweiVrpExec({ deviceId, command, changeComment }) {
  const policy = validateHuaweiCommands(command);
  if (!policy.allowed) return { success: false, output: `⛔ ${policy.reason}` };
  const changing = policy.commands.some(line => !READ_ONLY.test(line));
  let normalizedComment = null;
  if (changing) {
    try { normalizedComment = normalizeChangeComment(changeComment); } catch (error) { return { success: false, output: `Alteração bloqueada: ${error.message}` }; }
  }
  const device = await getDeviceDecrypted(deviceId);
  if (!device) return { success: false, output: 'Dispositivo não encontrado' };
  if (device.type !== 'huawei_vrp') return { success: false, output: 'Dispositivo não é Huawei VRP' };
  logger.info(`SSH Huawei VRP: ${device.hostname} → ${policy.commands.join(' | ')}`);

  return new Promise(resolve => {
    const conn = new Client();
    let output = '';
    let settled = false;
    const finish = async (success, message) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      conn.end();
      const commandOk = success && !/(error:|unrecognized command|wrong parameter|incomplete command)/i.test(message || output);
      if (normalizedComment && commandOk) {
        const context = getExecutionContext();
        try { await recordDeviceChange({ deviceId, taskNumber: context.taskNumber, agentName: context.agentName || 'huawei_vrp', comment: normalizedComment, nativeAudit: 'Huawei CLI operation log' }); }
        catch (error) { logger.error(`Falha ao registrar comentário de mudança Huawei: ${error.message}`); }
      }
      resolve({ success: commandOk, output: `${message || output.trim() || '(sem saída)'}${normalizedComment && commandOk ? `\n📝 ${formatChangeMarker(normalizedComment, getExecutionContext().taskNumber)}` : ''}`, device: { name: device.name, hostname: device.hostname } });
    };
    const timeout = setTimeout(() => finish(false, `Timeout: sessão Huawei excedeu 60s em ${device.hostname}\n${output}`), 60000);
    conn.on('ready', () => {
      conn.shell({ term: 'vt100', cols: 240, rows: 1000 }, (error, stream) => {
        if (error) return finish(false, `Erro ao abrir terminal VRP: ${error.message}`);
        const queue = ['screen-length 0 temporary', ...policy.commands];
        let index = 0;
        let lastSentAt = 0;
        const sendNext = () => {
          if (index >= queue.length) { stream.write('quit\n'); setTimeout(() => finish(true), 300); return; }
          const next = queue[index++];
          output += `\n$ ${next}\n`;
          lastSentAt = Date.now();
          stream.write(`${next}\n`);
        };
        stream.on('data', data => {
          const text = data.toString().replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
          output += text;
          if (Date.now() - lastSentAt > 100 && /(?:<[^>\r\n]+>|\[[^\]\r\n]+\])\s*$/.test(output)) sendNext();
        });
        stream.stderr.on('data', data => { output += `\nSTDERR: ${data}`; });
        stream.on('close', () => finish(true));
        setTimeout(() => { if (index === 0) sendNext(); }, 250);
      });
    });
    conn.on('error', error => finish(false, `Erro de conexão SSH: ${error.message}`));
    conn.connect({
      host: device.hostname, port: device.port, username: device.username, password: device.password, readyTimeout: 12000,
      algorithms: { kex: ['curve25519-sha256', 'ecdh-sha2-nistp256', 'diffie-hellman-group14-sha256', 'diffie-hellman-group14-sha1'] },
    });
  });
}

export const sshHuaweiVrpToolDefinition = {
  name: 'ssh_huawei_vrp_exec',
  description: 'Executa comandos Huawei VRP via SSH interativo. Em diagnóstico use display, ping ou tracert. Envie múltiplos comandos separados por quebra de linha.',
  input_schema: {
    type: 'object',
    properties: {
      deviceId: { type: 'string', description: 'ID do equipamento Huawei VRP' },
      command: { type: 'string', description: 'Um ou mais comandos VRP separados por quebra de linha' },
      changeComment: { type: 'string', description: 'Obrigatório em alterações: resumo permanente vinculado ao equipamento e à Task.' },
    },
    required: ['deviceId', 'command'],
  },
};
