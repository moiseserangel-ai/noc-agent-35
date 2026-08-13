import prisma from '../database/client.js';
import { capacityConfig, zabbixCall } from './capacity.service.js';
import { logAudit } from './audit.service.js';
import { addTaskMessage, createTask, updateTask } from './task.service.js';
import { notifyTask } from './notification.service.js';
import logger from '../utils/logger.js';

const numberOrNull = value => { const valueNumber = Number(value); return Number.isFinite(valueNumber) ? valueNumber : null; };
const round = value => value === null ? null : Math.round(value * 100) / 100;
const normalize = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const bitsPerSecond = item => {
  const value = numberOrNull(item?.lastvalue);
  if (value === null) return null;
  return item.units === 'Bps' ? value * 8 : value;
};
const matchesInterface = (item, interfaceName) => {
  const target = normalize(interfaceName);
  return target && [item.key_, item.name].some(value => normalize(value).includes(target));
};
const pick = (items, prefix, interfaceName) => items
  .filter(item => item.status === '0' && item.key_.startsWith(prefix) && matchesInterface(item, interfaceName))
  .sort((a, b) => Number(b.lastclock) - Number(a.lastclock))[0];
const hostMetric = (items, prefix) => items
  .filter(item => item.status === '0' && item.key_.startsWith(prefix))
  .sort((a, b) => Number(b.lastclock) - Number(a.lastclock))[0];
const interfaceNames = link => {
  const label = String(link.label || '').split(/\s*(?:↔|<->)\s*/);
  return [link.sourceInterface || label[0] || null, link.targetInterface || label[1] || null];
};
const median = values => { const sorted = [...values].sort((a, b) => a - b); if (!sorted.length) return null; const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; };
const percentile = (values, percentage) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentage) - 1)] : null; };

export function analyzeLatencyBaseline(history, current) {
  const values = history.map(row => numberOrNull(row.latencyMs)).filter(value => value !== null && value >= 0);
  if (values.length < 8 || current === null) return { baselineLatencyMs: null, latencyDeviationPct: null, latencyAnomaly: false, thresholdMs: null };
  const baselineLatencyMs = median(values);
  const p90 = percentile(values, .90);
  const thresholdMs = Math.max(baselineLatencyMs + 20, baselineLatencyMs * 2, p90 * 1.5);
  const latencyDeviationPct = baselineLatencyMs > 0 ? (current - baselineLatencyMs) / baselineLatencyMs * 100 : null;
  return { baselineLatencyMs: round(baselineLatencyMs), latencyDeviationPct: round(latencyDeviationPct), latencyAnomaly: current >= thresholdMs, thresholdMs: round(thresholdMs) };
}

export function diagnoseLinkAnomaly({ utilization, packetLoss, latencyAnomaly }) {
  if (!latencyAnomaly) return null;
  if (packetLoss !== null && packetLoss >= 5) return 'Instabilidade ou perda de pacotes';
  if (utilization !== null && utilization >= 75) return 'Provável congestionamento do link';
  return 'Aumento anormal de latência; verificar rota, operadora e pontas do enlace';
}

export function shouldRequestSpecialistAnalysis(task, telemetry) {
  if (task?.priority === 'critical') return true;
  if (!telemetry?.latencyAnomaly) return false;
  return !telemetry.anomalyReason || /rota|operadora|pontas/i.test(telemetry.anomalyReason);
}

function queueSpecialistAnalysis({ task, link, telemetry }) {
  if (!shouldRequestSpecialistAnalysis(task, telemetry)) return;
  setImmediate(async () => {
    try {
      const { createSpecialistAgents } = await import('../vendors/registry.js');
      const agent = createSpecialistAgents()[link.sourceDevice.type];
      if (!agent) {
        await addTaskMessage(task.id, 'system', `Análise complementar não executada: não existe especialista para ${link.sourceDevice.type}.`);
        return;
      }
      const request = [
        'Realize uma análise complementar SOMENTE LEITURA desta degradação de link.',
        'Não proponha nem execute alterações. Consulte interfaces, recursos, rotas, logs, ping e traceroute somente quando forem úteis.',
        metricText(telemetry, link),
        `Ponta de destino: ${link.targetDevice.name} (${link.targetDevice.hostname || 'endereço não informado'}).`,
        'Correlacione as evidências e informe: causa provável, nível de confiança, impacto e próximas verificações recomendadas.',
      ].join('\n');
      const result = await agent.diagnose(link.sourceDeviceId, link.sourceDevice.name, request, task.taskNumber);
      if (!result?.text || result.text.startsWith('❌')) {
        await addTaskMessage(task.id, 'system', 'Análise complementar por IA indisponível. O incidente permanece acompanhado pelas regras e pela telemetria.');
        return;
      }
      const ruleDiagnosis = metricText(telemetry, link);
      const diagnosis = `Diagnóstico determinístico:\n${ruleDiagnosis}\n\nAnálise complementar do especialista:\n${result.text}`;
      const updated = await prisma.task.update({ where: { id: task.id }, data: { diagnosis }, include: { device: true } });
      await addTaskMessage(task.id, 'agent', `Análise complementar (${result.provider || 'provedor disponível'}${result.model ? ` · ${result.model}` : ''}):\n${result.text}`, link.sourceDevice.type);
      await notifyTask(updated, 'diagnosed', { message: `Análise complementar concluída:\n${result.text.slice(0, 2500)}` }).catch(() => {});
      await logAudit({ username: 'system', displayName: 'Analisador de links', role: 'system', action: 'ai_diagnosis', resource: 'topology_link', resourceId: link.id, status: 'success', details: { taskNumber: task.taskNumber, provider: result.provider || null, model: result.model || null } });
    } catch (error) {
      logger.warn(`Topology specialist analysis for Task #${task.taskNumber} failed: ${error.message}`);
      await addTaskMessage(task.id, 'system', 'Análise complementar por IA indisponível. O incidente permanece acompanhado pelas regras e pela telemetria.').catch(() => {});
    }
  });
}

export function linkTelemetryStatus({ utilization, latencyMs, packetLoss, inputBps, outputBps }) {
  if (packetLoss >= 100 || utilization >= 90) return 'critical';
  if (packetLoss >= 5 || utilization >= 75 || latencyMs >= 100) return 'warning';
  if ([utilization, latencyMs, packetLoss, inputBps, outputBps].some(value => value !== null && value !== undefined)) return 'online';
  return 'unknown';
}

const openTaskStatuses = ['pending', 'diagnosing', 'awaiting_approval', 'executing', 'open', 'acknowledged', 'in_progress'];
const violatesPolicy = (row, link) => row && (
  row.latencyAnomaly === true ||
  (row.utilization !== null && row.utilization >= link.warningUtilization) ||
  (row.latencyMs !== null && row.latencyMs >= link.warningLatencyMs) ||
  (row.packetLoss !== null && row.packetLoss >= link.warningPacketLoss)
);
const metricText = (row, link) => [
  `Link: ${link.sourceDevice.name} (${link.sourceInterface || 'interface não informada'}) ↔ ${link.targetDevice.name} (${link.targetInterface || 'interface não informada'})`,
  `Utilização: ${row.utilization === null ? 'sem dados' : `${row.utilization}%`}`,
  `Latência: ${row.latencyMs === null ? 'sem dados' : `${row.latencyMs} ms`}`,
  `Baseline: ${row.baselineLatencyMs === null ? 'ainda não calculado' : `${row.baselineLatencyMs} ms (${row.latencyDeviationPct >= 0 ? '+' : ''}${row.latencyDeviationPct}%)`}`,
  `Perda: ${row.packetLoss === null ? 'sem dados' : `${row.packetLoss}%`}`,
  row.anomalyReason ? `Diagnóstico por regras: ${row.anomalyReason}` : '',
  `Limites: utilização ${link.warningUtilization}%, latência ${link.warningLatencyMs} ms, perda ${link.warningPacketLoss}%`,
].filter(Boolean).join('\n');

async function reconcileLinkIncident(link) {
  if (!link.monitoringEnabled) return { action: 'disabled' };
  const sampleCount = Math.max(link.confirmationSamples, link.recoverySamples, 2);
  const samples = await prisma.topologyLinkTelemetry.findMany({ where: { linkId: link.id }, orderBy: { collectedAt: 'desc' }, take: sampleCount });
  const degraded = samples.length >= link.confirmationSamples && samples.slice(0, link.confirmationSamples).every(row => violatesPolicy(row, link));
  const recovered = samples.length >= link.recoverySamples && samples.slice(0, link.recoverySamples).every(row => !violatesPolicy(row, link));
  const activeTask = link.activeTaskId ? await prisma.task.findUnique({ where: { id: link.activeTaskId } }) : null;
  if (degraded && link.degradationState !== 'degraded') {
    const latest = samples[0];
    const critical = (latest.utilization !== null && latest.utilization >= link.criticalUtilization) || latest.packetLoss >= 100;
    const message = `Degradação sustentada detectada no mapa de rede.\n${metricText(latest, link)}\nConfirmação: ${link.confirmationSamples} coletas consecutivas.`;
    const task = await createTask({ source: 'topology_telemetry', workType: 'incident', deviceId: link.sourceDeviceId, priority: critical ? 'critical' : 'high', originalMessage: message, incident: { incidentKey: `topology-link:${link.id}:${Date.now()}`, incidentOpenedAt: new Date(), lastSeenAt: new Date() } });
    await addTaskMessage(task.id, 'system', 'Incidente criado automaticamente pela telemetria sustentada do link.');
    await prisma.topologyLink.update({ where: { id: link.id }, data: { degradationState: 'degraded', degradationStartedAt: new Date(), activeTaskId: task.id } });
    await notifyTask(task, 'opened', { message }).catch(() => {});
    queueSpecialistAnalysis({ task, link, telemetry: latest });
    return { action: 'opened', taskNumber: task.taskNumber };
  }
  if (degraded && activeTask && openTaskStatuses.includes(activeTask.status)) {
    await prisma.task.update({ where: { id: activeTask.id }, data: { lastSeenAt: new Date(), diagnosis: metricText(samples[0], link) } });
    return { action: 'updated', taskNumber: activeTask.taskNumber };
  }
  if (recovered && link.degradationState === 'degraded') {
    const note = `Link normalizado após ${link.recoverySamples} coletas consecutivas.\n${metricText(samples[0], link)}`;
    if (activeTask && openTaskStatuses.includes(activeTask.status)) {
      const now = new Date();
      const task = await updateTask(activeTask.id, { status: 'resolved', resolvedAt: now, resolutionType: 'topology_automatic', resolutionSummary: note, validatedAt: now });
      await addTaskMessage(activeTask.id, 'system', note);
      await notifyTask(task, 'resolved', { message: note }).catch(() => {});
    }
    await prisma.topologyLink.update({ where: { id: link.id }, data: { degradationState: 'normal', degradationStartedAt: null, activeTaskId: null } });
    return { action: 'resolved', taskNumber: activeTask?.taskNumber || null };
  }
  return { action: 'unchanged' };
}

export async function updateTopologyLinkPolicy(linkId, input) {
  const bounded = (value, fallback, min, max) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback;
  const warningUtilization = bounded(input.warningUtilization, 75, 1, 100);
  const criticalUtilization = Math.max(warningUtilization, bounded(input.criticalUtilization, 90, 1, 100));
  return prisma.topologyLink.update({ where: { id: String(linkId) }, data: {
    monitoringEnabled: input.monitoringEnabled !== false,
    warningUtilization,
    criticalUtilization,
    warningLatencyMs: bounded(input.warningLatencyMs, 100, 1, 60000),
    warningPacketLoss: bounded(input.warningPacketLoss, 5, 0.1, 100),
    confirmationSamples: Math.round(bounded(input.confirmationSamples, 2, 2, 12)),
    recoverySamples: Math.round(bounded(input.recoverySamples, 2, 2, 12)),
  } });
}

export async function topologyLinkTelemetryHistory(linkId, hours = 24) {
  const periodHours = [1, 24, 168, 720].includes(Number(hours)) ? Number(hours) : 24;
  const link = await prisma.topologyLink.findUnique({ where: { id: String(linkId) }, select: { id: true } });
  if (!link) throw Object.assign(new Error('Conexão não encontrada'), { statusCode: 404 });
  const raw = await prisma.topologyLinkTelemetry.findMany({
    where: { linkId: link.id, collectedAt: { gte: new Date(Date.now() - periodHours * 3600000) } },
    orderBy: { collectedAt: 'asc' },
  });
  const maxPoints = 240;
  const bucketSize = Math.max(1, Math.ceil(raw.length / maxPoints));
  const average = (rows, field) => {
    const values = rows.map(row => row[field]).filter(value => value !== null);
    return values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
  };
  const points = [];
  for (let index = 0; index < raw.length; index += bucketSize) {
    const rows = raw.slice(index, index + bucketSize);
    points.push({
      collectedAt: rows.at(-1).collectedAt,
      inputBps: average(rows, 'inputBps'), outputBps: average(rows, 'outputBps'), utilization: average(rows, 'utilization'),
      latencyMs: average(rows, 'latencyMs'), packetLoss: average(rows, 'packetLoss'),
      baselineLatencyMs: average(rows, 'baselineLatencyMs'), latencyDeviationPct: average(rows, 'latencyDeviationPct'), latencyAnomaly: rows.some(row => row.latencyAnomaly),
      status: rows.some(row => row.status === 'critical') ? 'critical' : rows.some(row => row.status === 'warning') ? 'warning' : rows.at(-1).status,
    });
  }
  const values = field => raw.map(row => row[field]).filter(value => value !== null);
  const maximum = field => values(field).length ? round(Math.max(...values(field))) : null;
  let saturationEvents = 0;
  let consecutive = 0;
  for (const row of raw) {
    if (row.utilization !== null && row.utilization >= 75) consecutive++;
    else { if (consecutive >= 2) saturationEvents++; consecutive = 0; }
  }
  if (consecutive >= 2) saturationEvents++;
  return {
    periodHours, samples: raw.length, points,
    summary: { averageUtilization: average(raw, 'utilization'), maximumUtilization: maximum('utilization'), maximumLatencyMs: maximum('latencyMs'), maximumPacketLoss: maximum('packetLoss'), saturationEvents },
    thresholds: { warningUtilization: 75, criticalUtilization: 90, warningLatencyMs: 100, warningPacketLoss: 5 },
  };
}

let collectionRunning = false;

export async function collectTopologyLinkTelemetry({ username = 'system' } = {}) {
  if (collectionRunning) return { skipped: true, message: 'Coleta de telemetria já está em execução' };
  collectionRunning = true;
  try {
    const config = await capacityConfig();
    if (!config.url || !config.token) throw Object.assign(new Error('Configure URL e token de API do Zabbix'), { statusCode: 400 });
    const links = await prisma.topologyLink.findMany({ include: {
      sourceDevice: { select: { id: true, name: true, hostname: true, type: true, zabbixHostId: true } },
      targetDevice: { select: { id: true, name: true, hostname: true, type: true, zabbixHostId: true } },
    } });
    const hostIds = [...new Set(links.flatMap(link => [link.sourceDevice.zabbixHostId, link.targetDevice.zabbixHostId]).filter(Boolean).map(String))];
    if (!hostIds.length) return { links: links.length, collected: 0, matched: 0, message: 'Nenhuma ponta possui Zabbix Host ID' };
    const items = await zabbixCall(config, 'item.get', {
      hostids: hostIds,
      output: ['itemid', 'hostid', 'name', 'key_', 'lastvalue', 'lastclock', 'units', 'status'],
      monitored: true,
      searchByAny: true,
      search: { key_: ['net.if.in', 'net.if.out', 'net.if.speed', 'icmppingsec', 'icmppingloss'] },
    });
    const byHost = new Map();
    for (const item of items) byHost.set(String(item.hostid), [...(byHost.get(String(item.hostid)) || []), item]);
    let collected = 0;
    let matched = 0;
    for (const link of links) {
      const names = interfaceNames(link);
      const endpoints = [
        { device: link.sourceDevice, interfaceName: names[0], targetSide: false },
        { device: link.targetDevice, interfaceName: names[1], targetSide: true },
      ];
      const candidates = [];
      for (const endpoint of endpoints) {
        if (!endpoint.device.zabbixHostId) continue;
        const rows = byHost.get(String(endpoint.device.zabbixHostId)) || [];
        const input = endpoint.interfaceName ? pick(rows, 'net.if.in', endpoint.interfaceName) : null;
        const output = endpoint.interfaceName ? pick(rows, 'net.if.out', endpoint.interfaceName) : null;
        const speed = endpoint.interfaceName ? pick(rows, 'net.if.speed', endpoint.interfaceName) : null;
        const latency = hostMetric(rows, 'icmppingsec');
        const loss = hostMetric(rows, 'icmppingloss');
        if (input || output || speed || latency || loss) {
          matched++;
          candidates.push({
            endpoint,
            inputBps: bitsPerSecond(endpoint.targetSide ? output : input),
            outputBps: bitsPerSecond(endpoint.targetSide ? input : output),
            speedBps: bitsPerSecond(speed),
            latencyMs: latency ? numberOrNull(latency.lastvalue) * 1000 : null,
            packetLoss: numberOrNull(loss?.lastvalue),
            items: [input, output, speed, latency, loss].filter(Boolean).map(item => item.itemid),
          });
        }
      }
      const preferred = candidates.find(row => row.inputBps !== null || row.outputBps !== null || row.speedBps !== null) || candidates[0] || null;
      const capacityBps = link.bandwidthMbps ? link.bandwidthMbps * 1_000_000 : preferred?.speedBps || null;
      const inputBps = preferred?.inputBps ?? null;
      const outputBps = preferred?.outputBps ?? null;
      const utilization = capacityBps ? Math.max(inputBps || 0, outputBps || 0) / capacityBps * 100 : null;
      const latencyMs = candidates.map(row => row.latencyMs).filter(value => value !== null).sort((a, b) => b - a)[0] ?? null;
      const packetLoss = candidates.map(row => row.packetLoss).filter(value => value !== null).sort((a, b) => b - a)[0] ?? null;
      const latencyHistory = latencyMs === null ? [] : await prisma.topologyLinkTelemetry.findMany({ where: { linkId: link.id, latencyMs: { not: null }, collectedAt: { gte: new Date(Date.now() - 7 * 86400000) } }, orderBy: { collectedAt: 'desc' }, take: 672, select: { latencyMs: true } });
      const baseline = analyzeLatencyBaseline(latencyHistory, latencyMs);
      const anomalyReason = diagnoseLinkAnomaly({ utilization, packetLoss, latencyAnomaly: baseline.latencyAnomaly });
      const status = baseline.latencyAnomaly ? 'warning' : linkTelemetryStatus({ utilization, latencyMs, packetLoss, inputBps, outputBps });
      await prisma.topologyLinkTelemetry.create({ data: {
        linkId: link.id, inputBps: round(inputBps), outputBps: round(outputBps), capacityBps: round(capacityBps),
        utilization: round(utilization), latencyMs: round(latencyMs), baselineLatencyMs: baseline.baselineLatencyMs, latencyDeviationPct: baseline.latencyDeviationPct, latencyAnomaly: baseline.latencyAnomaly, anomalyReason, packetLoss: round(packetLoss), status,
        evidence: JSON.stringify({ endpoint: preferred?.endpoint.device.name || null, interface: preferred?.endpoint.interfaceName || null, itemIds: preferred?.items || [] }),
      } });
      await reconcileLinkIncident(link).catch(error => logger.warn(`Topology link incident ${link.id} failed: ${error.message}`));
      collected++;
    }
    await prisma.topologyLinkTelemetry.deleteMany({ where: { collectedAt: { lt: new Date(Date.now() - 90 * 86400000) } } });
    await logAudit({ username, displayName: username === 'system' ? 'Coletor de links Zabbix' : username, role: username === 'system' ? 'system' : 'admin', action: 'collect', resource: 'topology_telemetry', status: 'success', details: { links: links.length, collected, matched, items: items.length } });
    return { links: links.length, collected, matched, items: items.length };
  } finally {
    collectionRunning = false;
  }
}
