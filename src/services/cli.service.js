import prisma from '../database/client.js';
import { withApprovedRemediation } from '../security/execution-context.js';
import { sshMikrotikExec } from '../tools/ssh-mikrotik.tool.js';
import { sshLinuxExec } from '../tools/ssh-linux.tool.js';
import { sshHuaweiVrpExec } from '../tools/ssh-huawei-vrp.tool.js';
import { sshCiscoIosExec } from '../tools/ssh-cisco-ios.tool.js';
import { sshJuniperJunosExec } from '../tools/ssh-juniper-junos.tool.js';
import { sshFortiGateExec } from '../tools/ssh-fortigate-fortios.tool.js';
import { sshEdgeOsExec } from '../tools/ssh-ubiquiti-edgeos.tool.js';
import { sshDatacomDmosExec, sshNokiaSrosExec } from '../tools/ssh-profiled-network.tool.js';

const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_COMMAND_LENGTH = 8000;
const READ_ONLY = {
  mikrotik: line => /^\/?(?:ping\b|tool\s+traceroute\b)/i.test(line) || /\b(?:print|monitor|export)\b/i.test(line),
  huawei_vrp: line => /^(?:display\b|ping\b|tracert\b|screen-length\s+0\s+temporary\b)/i.test(line),
  cisco_ios: line => /^(?:show\b|ping\b|traceroute\b|terminal length\s+0\b)/i.test(line),
  juniper_junos: line => /^(?:show\b|ping\b|traceroute\b|monitor\b|set cli screen-length 0\b)/i.test(line),
  fortigate_fortios: line => /^(?:get\b|show\b|diagnose\b|execute\s+(?:ping|ping-options|traceroute)\b)/i.test(line),
  ubiquiti_edgeos: line => /^(?:show\b|ping\b|traceroute\b|mtr\b|ubnt-device-info\b)/i.test(line),
  datacom_dmos: line => /^(?:show\b|ping\b|traceroute\b)/i.test(line),
  nokia_sros: line => /^(?:show\b|ping\b|traceroute\b|tools perform (?:ping|traceroute)\b|environment more false\b)/i.test(line),
  linux: line => /^(?:uptime|free\b|df\b|du\b|top\b|ps\b|ss\b|netstat\b|ip\s+(?:addr|address|route|link|neigh)\b|ping\b|traceroute\b|journalctl\b|dmesg\b|cat\s+(?:\/etc\/os-release|\/(?:(?:var\/log)|proc|sys)\/)|tail\b|head\b|grep\b|systemctl\s+(?:status|list-units|list-unit-files|is-active|is-enabled|show)\b|ls\b|findmnt\b|mount\s*$|hostname\b|uname\b|who\b|w\b)/i.test(line),
};

const EXECUTORS = {
  mikrotik: sshMikrotikExec,
  huawei_vrp: sshHuaweiVrpExec,
  cisco_ios: sshCiscoIosExec,
  juniper_junos: sshJuniperJunosExec,
  fortigate_fortios: sshFortiGateExec,
  ubiquiti_edgeos: sshEdgeOsExec,
  datacom_dmos: sshDatacomDmosExec,
  nokia_sros: sshNokiaSrosExec,
  linux: sshLinuxExec,
};

export function classifyCliCommand(deviceType, command) {
  const value = String(command || '').trim();
  if (!value) return { valid: false, reason: 'Informe um comando.' };
  if (value.length > MAX_COMMAND_LENGTH) return { valid: false, reason: `O comando deve ter no máximo ${MAX_COMMAND_LENGTH} caracteres.` };
  if (!EXECUTORS[deviceType] || !READ_ONLY[deviceType]) return { valid: false, reason: 'Este tipo de equipamento ainda não possui terminal CLI.' };
  const lines = value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  return { valid: true, type: lines.every(READ_ONLY[deviceType]) ? 'read' : 'change', lines };
}

export async function createCliSession({ user, device, ipAddress, userAgent }) {
  await prisma.cliSession.updateMany({
    where: { userId: user.sub, status: 'active' },
    data: { status: 'closed', endedAt: new Date() },
  });
  return prisma.cliSession.create({
    data: {
      userId: user.sub,
      username: user.username,
      userRole: user.role,
      deviceId: device.id,
      deviceName: device.name,
      deviceType: device.type,
      hostname: device.hostname,
      ipAddress: ipAddress || null,
      userAgent: userAgent ? String(userAgent).slice(0, 300) : null,
    },
  });
}

export async function getOwnedSession(id, user) {
  const session = await prisma.cliSession.findUnique({ where: { id } });
  if (!session || (session.userId !== user.sub && user.role !== 'admin')) return null;
  if (session.status === 'active' && Date.now() - session.lastActiveAt.getTime() > SESSION_TTL_MS) {
    return prisma.cliSession.update({ where: { id }, data: { status: 'expired', endedAt: new Date() } });
  }
  return session;
}

export async function executeCliCommand({ session, user, command, justification }) {
  const policy = classifyCliCommand(session.deviceType, command);
  if (!policy.valid) throw Object.assign(new Error(policy.reason), { statusCode: 400 });
  if (policy.type === 'change' && user.role !== 'admin') throw Object.assign(new Error('Somente administradores podem executar alterações pelo Terminal CLI.'), { statusCode: 403 });

  const record = await prisma.cliCommand.create({
    data: {
      sessionId: session.id,
      command: String(command).trim(),
      commandType: policy.type,
      justification: policy.type === 'change' && String(justification || '').trim() ? String(justification).trim() : null,
    },
  });
  const startedAt = Date.now();
  let result;
  try {
    const executor = EXECUTORS[session.deviceType];
    const input = { deviceId: session.deviceId, command: String(command).trim(), changeComment: justification || 'Alteração manual via Terminal CLI' };
    result = policy.type === 'change'
      ? await withApprovedRemediation(() => executor(input), { agentName: `cli:${user.username}`, deviceId: session.deviceId })
      : await executor(input);
  } catch (error) {
    result = { success: false, output: `Erro interno ao executar comando: ${error.message}` };
  }
  const durationMs = Date.now() - startedAt;
  const status = result.success ? 'success' : (/bloqueado|blocked/i.test(result.output || '') ? 'blocked' : 'failure');
  const updated = await prisma.cliCommand.update({
    where: { id: record.id },
    data: { status, output: String(result.output || '').slice(0, 100000), durationMs },
  });
  await prisma.cliSession.update({ where: { id: session.id }, data: { lastActiveAt: new Date() } });
  return updated;
}

export function closeCliSession(id) {
  return prisma.cliSession.update({ where: { id }, data: { status: 'closed', endedAt: new Date() } });
}
