import { Client } from 'ssh2';
import { getDeviceDecrypted } from '../services/device.service.js';
import { getExecutionContext, isRemediationApproved } from '../security/execution-context.js';
import { formatChangeMarker, normalizeChangeComment, recordDeviceChange } from '../services/device-change.service.js';
import logger from '../utils/logger.js';

const READ_ONLY = /^(?:get\b|show\b|diagnose\b|execute\s+(?:ping|ping-options|traceroute)\b)/i;
const BLOCKED = [
  /\bexecute\s+(?:reboot|shutdown|factoryreset|formatlogdisk)\b/i,
  /\bexecute\s+disk\s+format\b/i,
  /\bexecute\s+restore\b/i,
  /\bexecute\s+backup\s+config\s+usb\b/i,
  /\bpurge\b/i,
];

export function validateFortiGateCommands(command, approved = isRemediationApproved()) {
  const commands = String(command || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!commands.length) return { allowed: false, reason: 'Nenhum comando informado', commands };
  if (commands.some(line => BLOCKED.some(pattern => pattern.test(line)))) {
    return { allowed: false, reason: 'Comando destrutivo bloqueado pela política FortiGate', commands };
  }
  if (!approved && commands.some(line => !READ_ONLY.test(line))) {
    return { allowed: false, reason: 'Comando de alteração bloqueado: diagnóstico permite get, show, diagnose, ping e traceroute.', commands };
  }
  return { allowed: true, commands };
}

export function ensureFortiGatePolicyComments(command, changeComment) {
  const comment = normalizeChangeComment(changeComment).replace(/[?"'\\]/g, '').slice(0, 100);
  const lines = String(command).split(/\r?\n/);
  const result = [];
  let policyContext = false;
  let editOpen = false;
  let hasComment = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^config firewall (?:policy|policy6)$/i.test(trimmed)) policyContext = true;
    if (policyContext && /^edit\s+\S+/i.test(trimmed)) { editOpen = true; hasComment = false; }
    if (editOpen && /^set comments\s+/i.test(trimmed)) hasComment = true;
    if (editOpen && /^next$/i.test(trimmed) && !hasComment) result.push(`set comments "${comment}"`);
    result.push(line);
    if (/^next$/i.test(trimmed)) editOpen = false;
    if (/^end$/i.test(trimmed)) { policyContext = false; editOpen = false; }
  }
  if (policyContext && editOpen && !hasComment) result.push(`set comments "${comment}"`);
  return result.join('\n');
}

export async function sshFortiGateExec({ deviceId, command, changeComment }) {
  const policy = validateFortiGateCommands(command);
  if (!policy.allowed) return { success: false, output: `⛔ ${policy.reason}` };
  const changing = policy.commands.some(line => !READ_ONLY.test(line));
  let normalizedComment = null;
  let commands = policy.commands;
  let nativeComment = false;
  if (changing) {
    try { normalizedComment = normalizeChangeComment(changeComment); }
    catch (error) { return { success: false, output: `Alteração bloqueada: ${error.message}` }; }
    const enriched = ensureFortiGatePolicyComments(commands.join('\n'), normalizedComment);
    commands = enriched.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    nativeComment = enriched !== policy.commands.join('\n');
  }
  const device = await getDeviceDecrypted(deviceId);
  if (!device) return { success: false, output: 'Dispositivo não encontrado' };
  if (device.type !== 'fortigate_fortios') return { success: false, output: 'Dispositivo não é Fortinet FortiGate' };
  logger.info(`SSH FortiGate: ${device.hostname} → ${commands.join(' | ')}`);

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
      const ok = success && !/(command parse error|unknown action|object check operator error|permission denied|return code -\d+)/i.test(text);
      if (normalizedComment && ok) {
        const context = getExecutionContext();
        try {
          await recordDeviceChange({
            deviceId,
            taskNumber: context.taskNumber,
            agentName: context.agentName || 'fortigate_fortios',
            comment: normalizedComment,
            nativeAudit: nativeComment ? 'FortiGate policy comments + histórico NOC' : 'histórico NOC',
          });
        } catch (error) { logger.error(`Falha ao registrar mudança FortiGate: ${error.message}`); }
      }
      resolve({
        success: ok,
        output: `${text}${normalizedComment && ok ? `\n📝 ${formatChangeMarker(normalizedComment, getExecutionContext().taskNumber)}${nativeComment ? '\n🏷️ comments nativo aplicado às políticas FortiGate compatíveis.' : ''}` : ''}`,
        device: { name: device.name, hostname: device.hostname },
      });
    };
    const timeout = setTimeout(() => finish(false, `Timeout: sessão FortiGate excedeu 60s em ${device.hostname}\n${output}`), 60000);
    conn.on('ready', () => conn.shell({ term: 'vt100', cols: 240, rows: 1000 }, (error, stream) => {
      if (error) return finish(false, `Erro ao abrir terminal FortiOS: ${error.message}`);
      let index = 0;
      let lastSentAt = 0;
      const sendNext = () => {
        if (index >= commands.length) { stream.write('exit\n'); setTimeout(() => finish(true), 350); return; }
        const next = commands[index++];
        output += `\n$ ${next}\n`;
        lastSentAt = Date.now();
        stream.write(`${next}\n`);
      };
      stream.on('data', data => {
        output += data.toString().replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
        if (Date.now() - lastSentAt > 120 && /(?:^|\n)[\w().:@/-]+\s*[#$]\s*$/.test(output)) sendNext();
      });
      stream.stderr.on('data', data => { output += `\nSTDERR: ${data}`; });
      stream.on('close', () => finish(true));
      setTimeout(sendNext, 300);
    }));
    conn.on('error', error => finish(false, `Erro de conexão SSH: ${error.message}`));
    conn.connect({ host:device.hostname, port:device.port, username:device.username, password:device.password, readyTimeout:12000 });
  });
}

export const sshFortiGateToolDefinition = {
  name:'ssh_fortigate_exec',
  description:'Executa comandos Fortinet FortiGate/FortiOS via SSH. Consultas aceitam get, show, diagnose, ping e traceroute; mudanças exigem aprovação.',
  input_schema:{type:'object',properties:{deviceId:{type:'string'},command:{type:'string'},changeComment:{type:'string',description:'Resumo obrigatório, aplicado como comments em políticas compatíveis.'}},required:['deviceId','command']},
};
