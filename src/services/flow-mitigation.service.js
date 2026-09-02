import net from 'node:net';
import prisma from '../database/client.js';
import { executeManagedDeviceCommand } from './cli.service.js';
import { runDeviceBackup } from './device-backup.service.js';
import { addTaskMessage } from './task.service.js';

const ADDRESS_LIST = 'NOC-ASSISTED-BLOCK';
const MAX_ACTIVE_BLOCKS = 20;
const reservedDns = new Set(['8.8.8.8','8.8.4.4','1.1.1.1','1.0.0.1','9.9.9.9','149.112.112.112']);
const canonical = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '').split('').sort().join('');
const quote = value => String(value).replaceAll('\\','\\\\').replaceAll('"','\\"');

export function publicMitigationTarget(ip) {
  if (net.isIP(ip) !== 4 || reservedDns.has(ip)) return false;
  const [a,b,c] = ip.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0 && c === 113));
}

async function trustedMitigationIps() {
  const row = await prisma.settings.findUnique({ where: { key: 'flow_security_profiles' } });
  try { const profiles = JSON.parse(row?.value || '{}'); return new Set(Object.values(profiles).flatMap(profile => Array.isArray(profile?.trustedIps) ? profile.trustedIps : []).map(String)); }
  catch { return new Set(); }
}

async function assertTargetIsSafe(targetIp) {
  if (!publicMitigationTarget(targetIp)) throw Object.assign(new Error('Mitigação recusada: somente IP público externo não reservado pode ser bloqueado'), { statusCode: 400 });
  const [protectedAddress, protectedDevice, trusted] = await Promise.all([
    prisma.ipamAddress.findFirst({ where: { address: targetIp, status: { not: 'available' } } }),
    prisma.device.findFirst({ where: { hostname: targetIp, isActive: true } }), trustedMitigationIps(),
  ]);
  if (protectedAddress || protectedDevice || trusted.has(targetIp)) throw Object.assign(new Error('Mitigação recusada: endereço protegido por Equipamentos, IPAM, CMDB ou lista confiável'), { statusCode: 400 });
}

async function managedRulesReady(device) {
  const result = await executeManagedDeviceCommand({ device, command: '/ip firewall filter print detail without-paging where comment~"NOC Agent: mitigacao assistida"', approved: false });
  if (!result.success) return false;
  const chunks = String(result.output || '').split(/\n(?=\s*\d+\s)/), rule = chain => chunks.some(chunk => !/^\s*\d+\s+X\b/.test(chunk) && chunk.includes(`chain=${chain}`) && chunk.includes('action=drop') && chunk.includes(`src-address-list=${ADDRESS_LIST}`) && chunk.includes('in-interface-list=OPERADORAS'));
  return rule('input') && rule('forward');
}

async function activeBlockCount(device) {
  const result = await executeManagedDeviceCommand({ device, command: `/ip firewall address-list print count-only where list="${ADDRESS_LIST}"`, approved: false });
  return result.success ? Number(String(result.output || '').match(/\d+/)?.[0] || 0) : MAX_ACTIVE_BLOCKS;
}

export async function flowMitigationReadiness(deviceId) {
  const device = await prisma.device.findUnique({ where: { id: String(deviceId) } });
  if (!device || device.type !== 'mikrotik') return { ready: false, rulesReady: false, activeBlocks: 0, maximumBlocks: MAX_ACTIVE_BLOCKS };
  const [rulesReady, activeBlocks] = await Promise.all([managedRulesReady(device), activeBlockCount(device)]);
  return { ready: rulesReady && activeBlocks < MAX_ACTIVE_BLOCKS, rulesReady, activeBlocks, maximumBlocks: MAX_ACTIVE_BLOCKS };
}

export async function prepareFlowMitigation(anomalyId, { durationMinutes = 30, username }) {
  const anomaly = await prisma.flowAnomaly.findUnique({ where: { id: anomalyId } });
  if (!anomaly || anomaly.status !== 'confirmed' || anomaly.classification !== 'attack') throw Object.assign(new Error('A mitigação exige uma anomalia confirmada como ataque'), { statusCode: 409 });
  const targetIp = String(anomaly.sourceAddress || ''); await assertTargetIsSafe(targetIp);
  const devices = await prisma.device.findMany({ where: { isActive: true, type: 'mikrotik' } });
  const device = devices.find(row => canonical(row.name) === canonical(anomaly.exporterName) || canonical(row.hostname) === canonical(anomaly.exporterName));
  if (!device) throw Object.assign(new Error(`Não foi possível relacionar ${anomaly.exporterName} a um MikroTik cadastrado`), { statusCode: 400 });
  const active = await prisma.flowMitigation.count({ where: { deviceId: device.id, status: 'active', expiresAt: { gt: new Date() } } });
  if (active >= MAX_ACTIVE_BLOCKS) throw Object.assign(new Error(`Limite de ${MAX_ACTIVE_BLOCKS} bloqueios ativos atingido neste equipamento`), { statusCode: 409 });
  const minutes = Math.min(240, Math.max(5, Math.round(Number(durationMinutes) || 30))), comment = `NOC Agent: mitigação assistida; Task #${anomaly.taskId || 'sem-task'}; ${minutes}min`, command = `/ip firewall address-list add list=${ADDRESS_LIST} address=${targetIp} timeout=${minutes}m comment="${quote(comment)}"`, validationCommand = `/ip firewall address-list print detail where list=${ADDRESS_LIST} and address=${targetIp}`, rollbackCommand = `/ip firewall address-list remove [find where list=${ADDRESS_LIST} and address=${targetIp}]`;
  const existing = await prisma.flowMitigation.findFirst({ where: { anomalyId, status: { in: ['proposed','active'] } } }); if (existing) return existing;
  return prisma.flowMitigation.create({ data: { anomalyId, taskId: anomaly.taskId, deviceId: device.id, deviceName: device.name, targetIp, addressList: ADDRESS_LIST, durationMinutes: minutes, command, validationCommand, rollbackCommand, requestedBy: username } });
}

export async function approveFlowMitigation(id, { username, confirmed }) {
  if (confirmed !== true) throw Object.assign(new Error('Confirmação explícita obrigatória'), { statusCode: 400 });
  const row = await prisma.flowMitigation.findUnique({ where: { id } }); if (!row || row.status !== 'proposed') throw Object.assign(new Error('Mitigação não está disponível para execução'), { statusCode: 409 });
  await assertTargetIsSafe(row.targetIp);
  const device = await prisma.device.findUnique({ where: { id: row.deviceId } }); if (!device || device.type !== 'mikrotik') throw Object.assign(new Error('Equipamento MikroTik indisponível'), { statusCode: 400 });
  if (!await managedRulesReady(device)) throw Object.assign(new Error(`Execução bloqueada: são obrigatórias regras ativas de input e forward para ${ADDRESS_LIST} nas interfaces OPERADORAS`), { statusCode: 409 });
  if (await activeBlockCount(device) >= MAX_ACTIVE_BLOCKS) throw Object.assign(new Error(`Limite de ${MAX_ACTIVE_BLOCKS} endereços simultaneamente bloqueados atingido`), { statusCode: 409 });
  await runDeviceBackup(device.id, { type: 'pre_mitigation', username });
  const result = await executeManagedDeviceCommand({ device, command: row.command, changeComment: `Mitigação assistida do IP ${row.targetIp}`, approved: true, agentName: 'flow-mitigation' });
  if (!result.success) { await prisma.flowMitigation.update({ where: { id }, data: { status: 'failed', approvedBy: username, approvedAt: new Date(), result: String(result.output || '').slice(0,4000) } }); throw new Error(result.output || 'Falha na mitigação'); }
  const validation = await executeManagedDeviceCommand({ device, command: row.validationCommand, approved: false });
  if (!validation.success || !String(validation.output || '').includes(row.targetIp)) { await executeManagedDeviceCommand({ device, command: row.rollbackCommand, changeComment: `Rollback da mitigação ${row.targetIp}`, approved: true, agentName: 'flow-mitigation' }); await prisma.flowMitigation.update({ where: { id }, data: { status: 'failed', approvedBy: username, approvedAt: new Date(), result: 'Validação falhou; rollback executado.' } }); throw new Error('A validação da mitigação falhou; rollback executado automaticamente'); }
  const now = new Date(), updated = await prisma.flowMitigation.update({ where: { id }, data: { status: 'active', approvedBy: username, approvedAt: now, executedAt: now, expiresAt: new Date(now.getTime() + row.durationMinutes * 60000), result: String(validation.output).slice(0,4000) } });
  if (row.taskId) await addTaskMessage(row.taskId, 'system', `Mitigação temporária aprovada por ${username}: IP ${row.targetIp} na lista ${ADDRESS_LIST} por ${row.durationMinutes} minutos.`); return updated;
}

export async function listFlowMitigations() { const now = new Date(); await prisma.flowMitigation.updateMany({ where: { status: 'active', expiresAt: { lte: now } }, data: { status: 'expired' } }); return prisma.flowMitigation.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }); }
