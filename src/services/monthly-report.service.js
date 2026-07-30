import PDFDocument from 'pdfkit';
import prisma from '../database/client.js';
import logger from '../utils/logger.js';
import { buildIncidentReport } from './report.service.js';
import { getNotificationConfig, sendTelegramMessage } from './notification.service.js';
import { sendWhatsAppMessage } from './evolution.service.js';

const ALLOWED_CHANNELS = ['panel', 'telegram', 'whatsapp'];
const split = value => [...new Set(String(value || '').split(',').map(item => item.trim()).filter(Boolean))];
const fmt = value => new Date(value).toLocaleDateString('pt-BR', { timeZone: 'America/Porto_Velho' });
const duration = seconds => seconds == null ? '—' : seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}min` : `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}min`;

export function validateMonthlyReportConfig(input = {}) {
  const day = Math.max(1, Math.min(28, Number(input.monthlyReportDay) || 1));
  const hour = Math.max(0, Math.min(23, Number(input.monthlyReportHour) || 8));
  const timezone = String(input.monthlyReportTimezone || 'America/Porto_Velho');
  try { new Intl.DateTimeFormat('pt-BR', { timeZone: timezone }).format(new Date()); } catch { throw Object.assign(new Error('Fuso horário inválido'), { statusCode: 400 }); }
  const channels = split(input.monthlyReportChannels || 'panel');
  if (!channels.length || channels.some(channel => !ALLOWED_CHANNELS.includes(channel))) throw Object.assign(new Error('Canais válidos: painel, Telegram e WhatsApp'), { statusCode: 400 });
  return {
    monthlyReportEnabled: input.monthlyReportEnabled === true,
    monthlyReportDay: day,
    monthlyReportHour: hour,
    monthlyReportTimezone: timezone,
    monthlyReportChannels: channels.join(','),
    monthlyReportRecipients: split(input.monthlyReportRecipients).join(',') || null,
    monthlyReportTelegramRecipients: split(input.monthlyReportTelegramRecipients).join(',') || null,
    monthlyReportWhatsappRecipients: split(input.monthlyReportWhatsappRecipients).map(value => value.replace(/\D/g, '')).filter(Boolean).join(',') || null,
  };
}

export function previousMonthPeriod(now = new Date()) {
  const local = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Porto_Velho', year: 'numeric', month: '2-digit' }).format(now);
  const [year, month] = local.split('-').map(Number);
  const previous = new Date(Date.UTC(year, month - 2, 1));
  const periodYear = previous.getUTCFullYear();
  const periodMonth = previous.getUTCMonth();
  const from = new Date(`${periodYear}-${String(periodMonth + 1).padStart(2, '0')}-01T00:00:00-04:00`);
  const lastDay = new Date(Date.UTC(periodYear, periodMonth + 1, 0)).getUTCDate();
  const to = new Date(`${periodYear}-${String(periodMonth + 1).padStart(2, '0')}-${lastDay}T23:59:59.999-04:00`);
  return { periodKey: `${periodYear}-${String(periodMonth + 1).padStart(2, '0')}`, from, to, fromKey: `${periodYear}-${String(periodMonth + 1).padStart(2, '0')}-01`, toKey: `${periodYear}-${String(periodMonth + 1).padStart(2, '0')}-${lastDay}` };
}

const reportText = (tenant, report, periodKey) => [
  `📊 Relatório mensal — ${tenant.name}`,
  `Período: ${periodKey}`,
  `Atividades: ${report.summary.total}`,
  `Incidentes: ${report.workTypes.incidents}`,
  `Consultas: ${report.workTypes.consultations}`,
  `Configurações: ${report.workTypes.configurations}`,
  `Resolvidos: ${report.summary.resolved} (${report.summary.resolutionRate}%)`,
  `MTTA: ${duration(report.summary.mttaSeconds)}`,
  `MTTR: ${duration(report.summary.mttrSeconds)}`,
  `SLA de resolução: ${report.summary.slaCompliance == null ? 'sem amostra' : `${report.summary.slaCompliance}%`}`,
  `Violações de SLA: ${report.summary.slaBreached}`,
].join('\n');

async function recordPanel(run, tenant, text, status = 'sent', error = null) {
  await prisma.notificationLog.upsert({
    where: { dedupKey: `monthly-report:${run.id}:panel` },
    create: { event: 'monthly_report', channel: 'panel', status, error, dedupKey: `monthly-report:${run.id}:panel`, title: `Relatório mensal · ${tenant.name}`, message: text, resourceType: 'monthly_report', resourceId: run.id },
    update: { status, error, message: text },
  });
}

export async function generateMonthlyReport(tenantId, now = new Date()) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant || !tenant.isActive) throw Object.assign(new Error('Cliente não encontrado ou inativo'), { statusCode: 404 });
  const period = previousMonthPeriod(now);
  const report = await buildIncidentReport({ from: period.fromKey, to: period.toKey }, tenant.id);
  const channels = split(tenant.monthlyReportChannels || 'panel').filter(channel => ALLOWED_CHANNELS.includes(channel));
  const telegramRecipients = split(tenant.monthlyReportTelegramRecipients || tenant.monthlyReportRecipients);
  const whatsappRecipients = split(tenant.monthlyReportWhatsappRecipients);
  const recipients = JSON.stringify({ telegram: telegramRecipients, whatsapp: whatsappRecipients });
  const run = await prisma.monthlyReportRun.upsert({
    where: { tenantId_periodKey: { tenantId: tenant.id, periodKey: period.periodKey } },
    create: { tenantId: tenant.id, periodKey: period.periodKey, periodFrom: period.from, periodTo: period.to, reportData: JSON.stringify(report), channels: channels.join(','), recipients },
    update: { reportData: JSON.stringify(report), channels: channels.join(','), recipients, status: 'pending', error: null, deliveryLog: null, completedAt: null },
  });
  const text = reportText(tenant, report, period.periodKey);
  const delivery = [];
  const cfg = await getNotificationConfig();
  for (const channel of channels) {
    if (channel === 'panel') {
      await recordPanel(run, tenant, text);
      delivery.push({ channel, status: 'sent' });
      continue;
    }
    const configuredTargets = channel === 'telegram' ? telegramRecipients : whatsappRecipients;
    const targets = channel === 'whatsapp' && !configuredTargets.length && tenant.contactPhone ? [tenant.contactPhone] : configuredTargets;
    if (!targets.length) {
      delivery.push({ channel, status: 'failed', error: 'Nenhum destinatário configurado' });
      continue;
    }
    for (const recipient of targets) {
      try {
        if (channel === 'telegram') await sendTelegramMessage(recipient, text, cfg.telegramToken);
        else await sendWhatsAppMessage(recipient, text);
        delivery.push({ channel, recipient, status: 'sent' });
      } catch (error) {
        delivery.push({ channel, recipient, status: 'failed', error: error.message });
      }
    }
  }
  const successes = delivery.filter(item => item.status === 'sent').length;
  const failures = delivery.filter(item => item.status === 'failed');
  const status = failures.length ? (successes ? 'partial' : 'failed') : 'sent';
  return prisma.monthlyReportRun.update({
    where: { id: run.id },
    data: { status, deliveryLog: JSON.stringify(delivery), error: failures.length ? failures.map(item => item.error).join('; ').slice(0, 1000) : null, completedAt: new Date() },
    include: { tenant: { select: { id: true, name: true } } },
  });
}

export async function runMonthlyReportScheduler(now = new Date()) {
  const tenants = await prisma.tenant.findMany({ where: { isActive: true, monthlyReportEnabled: true } });
  const period = previousMonthPeriod(now);
  const results = [];
  for (const tenant of tenants) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tenant.monthlyReportTimezone, day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(item => [item.type, item.value]));
    const localDay = Number(parts.day), localHour = Number(parts.hour);
    if (localDay < tenant.monthlyReportDay || (localDay === tenant.monthlyReportDay && localHour < tenant.monthlyReportHour)) continue;
    const exists = await prisma.monthlyReportRun.findUnique({ where: { tenantId_periodKey: { tenantId: tenant.id, periodKey: period.periodKey } }, select: { id: true } });
    if (exists) continue;
    try { results.push(await generateMonthlyReport(tenant.id, now)); }
    catch (error) { logger.error(`Monthly report ${tenant.name}: ${error.message}`); }
  }
  return results;
}

export function monthlyReportPdf(run) {
  const report = typeof run.reportData === 'string' ? JSON.parse(run.reportData) : run.reportData;
  const doc = new PDFDocument({ size: 'A4', margins: { top: 48, bottom: 48, left: 48, right: 48 }, info: { Title: `Relatório mensal ${run.periodKey}` } });
  const chunks = [];
  doc.on('data', chunk => chunks.push(chunk));
  const done = new Promise((resolve, reject) => { doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
  doc.fontSize(20).fillColor('#123047').text('Relatório mensal de operações');
  doc.moveDown(.35).fontSize(12).fillColor('#3f6176').text(`${run.tenant?.name || 'Cliente'} · ${fmt(run.periodFrom)} a ${fmt(run.periodTo)}`);
  doc.moveDown(1).fontSize(11).fillColor('#182b36');
  const rows = [
    ['Atividades', report.summary.total], ['Incidentes', report.workTypes.incidents], ['Consultas', report.workTypes.consultations],
    ['Configurações', report.workTypes.configurations], ['Resolvidos', `${report.summary.resolved} (${report.summary.resolutionRate}%)`],
    ['MTTA', duration(report.summary.mttaSeconds)], ['MTTR', duration(report.summary.mttrSeconds)],
    ['SLA de resolução', report.summary.slaCompliance == null ? 'Sem amostra' : `${report.summary.slaCompliance}%`], ['SLA violado', report.summary.slaBreached],
  ];
  rows.forEach(([label, value]) => { doc.fillColor('#537082').text(label, { continued: true, width: 230 }); doc.fillColor('#102a3b').text(String(value)); });
  doc.moveDown().fontSize(14).fillColor('#123047').text('Equipamentos com mais atividades');
  doc.moveDown(.4).fontSize(10);
  report.topDevices.slice(0, 10).forEach((item, index) => doc.fillColor('#182b36').text(`${index + 1}. ${item.name} — ${item.incidents} atividade(s), ${item.critical} crítica(s), ${item.resolved} resolvida(s)`));
  doc.end();
  return done;
}
