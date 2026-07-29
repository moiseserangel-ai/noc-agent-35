import { Client } from 'ssh2';
import { getDeviceDecrypted } from '../services/device.service.js';
import { getExecutionContext, isRemediationApproved } from '../security/execution-context.js';
import { formatChangeMarker, normalizeChangeComment, recordDeviceChange } from '../services/device-change.service.js';
import logger from '../utils/logger.js';

const READ_ONLY = /^(?:show\b|ping\b|traceroute\b|monitor\b|set cli screen-length 0\b)/i;
const BLOCKED = [
  /\brequest system reboot\b/i,
  /\brequest system halt\b/i,
  /\brequest system power-off\b/i,
  /\brequest system zeroize\b/i,
  /\brequest system snapshot delete\b/i,
  /\bfile delete\b.*(?:\/config|junos\.conf)/i,
  /\brollback\s+0\b/i,
];

export function validateJuniperCommands(command, approved = isRemediationApproved()) {
  const commands = String(command || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!commands.length) return { allowed: false, reason: 'Nenhum comando informado', commands };
  if (commands.some(line => BLOCKED.some(pattern => pattern.test(line)))) {
    return { allowed: false, reason: 'Comando destrutivo bloqueado pela política Juniper', commands };
  }
  if (!approved && commands.some(line => !READ_ONLY.test(line))) {
    return { allowed: false, reason: 'Comando de alteração bloqueado: diagnóstico permite somente show, ping, traceroute e monitor.', commands };
  }
  return { allowed: true, commands };
}

export function ensureJuniperNativeComments(command, changeComment) {
  const comment = normalizeChangeComment(changeComment).replace(/[?"'\\]/g, '').slice(0, 80);
  const lines = String(command).split(/\r?\n/);
  const changing = lines.some(line => /^(?:set|delete|deactivate|activate|rename|insert)\b/i.test(line.trim()));
  const alreadyCommented = lines.some(line => /^annotate\b/i.test(line.trim()));
  if (!changing || alreadyCommented) return lines.join('\n');
  const firstSet = lines.find(line => /^set\s+/i.test(line.trim()))?.trim();
  if (!firstSet) return lines.join('\n');
  const tokens = firstSet.replace(/^set\s+/i, '').split(/\s+/);
  const hierarchy = tokens[0] === 'interfaces' ? tokens.slice(0, 2).join(' ') : tokens.slice(0, 3).join(' ');
  return [...lines, `annotate ${hierarchy} "${comment}"`].join('\n');
}

export async function sshJuniperJunosExec({ deviceId, command, changeComment }) {
  const policy = validateJuniperCommands(command);
  if (!policy.allowed) return { success: false, output: `⛔ ${policy.reason}` };
  const changing = policy.commands.some(line => !READ_ONLY.test(line));
  let normalizedComment = null;
  let commands = policy.commands;
  let nativeComment = false;
  if (changing) {
    try { normalizedComment = normalizeChangeComment(changeComment); }
    catch (error) { return { success: false, output: `Alteração bloqueada: ${error.message}` }; }
    const enriched = ensureJuniperNativeComments(commands.join('\n'), normalizedComment);
    commands = enriched.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    nativeComment = enriched !== policy.commands.join('\n');
  }
  const device = await getDeviceDecrypted(deviceId);
  if (!device) return { success: false, output: 'Dispositivo não encontrado' };
  if (device.type !== 'juniper_junos') return { success: false, output: 'Dispositivo não é Juniper Junos' };
  logger.info(`SSH Juniper Junos: ${device.hostname} → ${commands.join(' | ')}`);

  return new Promise(resolve => {
    const conn = new Client();
    let output = '';
    let settled = false;
    const finish = async (success, message) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      conn.end();
      const text = message || output.trim() || '(sem saída)';
      const ok = success && !/(syntax error|unknown command|error:|configuration check-out failed|commit failed)/i.test(text);
      if (normalizedComment && ok) {
        const context = getExecutionContext();
        try {
          await recordDeviceChange({
            deviceId,
            taskNumber: context.taskNumber,
            agentName: context.agentName || 'juniper_junos',
            comment: normalizedComment,
            nativeAudit: nativeComment ? 'Juniper annotation + histórico NOC' : 'histórico NOC',
          });
        } catch (error) { logger.error(`Falha ao registrar mudança Juniper: ${error.message}`); }
      }
      resolve({
        success: ok,
        output: `${text}${normalizedComment && ok ? `\n📝 ${formatChangeMarker(normalizedComment, getExecutionContext().taskNumber)}${nativeComment ? '\n🏷️ annotate nativo aplicado à configuração Junos compatível.' : ''}` : ''}`,
        device: { name: device.name, hostname: device.hostname },
      });
    };
    const timeout = setTimeout(() => finish(false, `Timeout: sessão Juniper excedeu 60s em ${device.hostname}\n${output}`), 60000);
    conn.on('ready', () => conn.shell({ term: 'vt100', cols: 240, rows: 1000 }, (error, stream) => {
      if (error) return finish(false, `Erro ao abrir terminal Junos: ${error.message}`);
      const queue = ['set cli screen-length 0', ...commands];
      let index = 0;
      let lastSentAt = 0;
      const sendNext = () => {
        if (index >= queue.length) { stream.write('exit\n'); setTimeout(() => finish(true), 350); return; }
        const next = queue[index++];
        output += `\n$ ${next}\n`;
        lastSentAt = Date.now();
        stream.write(`${next}\n`);
      };
      stream.on('data', data => {
        output += data.toString().replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
        if (Date.now() - lastSentAt > 120 && /(?:^|\n)[\w.@:/-]+[>#]\s*$/.test(output)) sendNext();
      });
      stream.stderr.on('data', data => { output += `\nSTDERR: ${data}`; });
      stream.on('close', () => finish(true));
      setTimeout(sendNext, 300);
    }));
    conn.on('error', error => finish(false, `Erro de conexão SSH: ${error.message}`));
    conn.connect({
      host: device.hostname,
      port: device.port,
      username: device.username,
      password: device.password,
      readyTimeout: 12000,
      algorithms: { kex: ['curve25519-sha256', 'ecdh-sha2-nistp256', 'diffie-hellman-group14-sha256', 'diffie-hellman-group14-sha1'] },
    });
  });
}

export const sshJuniperJunosToolDefinition = {
  name: 'ssh_juniper_junos_exec',
  description: 'Executa comandos Juniper Junos via SSH. Diagnóstico aceita show, ping, traceroute e monitor; alterações exigem aprovação.',
  input_schema: {
    type: 'object',
    properties: {
      deviceId: { type: 'string' },
      command: { type: 'string' },
      changeComment: { type: 'string', description: 'Resumo obrigatório da mudança, registrado no NOC e como annotate quando compatível.' },
    },
    required: ['deviceId', 'command'],
  },
};
