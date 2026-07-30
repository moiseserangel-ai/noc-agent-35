import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { monthlyReportPdf, previousMonthPeriod, validateMonthlyReportConfig } from '../src/services/monthly-report.service.js';

test('calcula exatamente o mês civil anterior', () => {
  const period = previousMonthPeriod(new Date('2026-07-30T16:00:00Z'));
  assert.equal(period.periodKey, '2026-06');
  assert.equal(period.fromKey, '2026-06-01');
  assert.equal(period.toKey, '2026-06-30');
});

test('valida agenda, canais e destinatários mensais', () => {
  const config = validateMonthlyReportConfig({
    monthlyReportEnabled: true,
    monthlyReportDay: 31,
    monthlyReportHour: 25,
    monthlyReportChannels: 'panel,telegram,whatsapp',
    monthlyReportTelegramRecipients: '-1001,@noc',
    monthlyReportWhatsappRecipients: '+55 (69) 99999-9999',
  });
  assert.equal(config.monthlyReportDay, 28);
  assert.equal(config.monthlyReportHour, 23);
  assert.equal(config.monthlyReportWhatsappRecipients, '5569999999999');
});

test('proteções de Task bloqueiam referências cruzadas por número e equipamento', () => {
  const routes = fs.readFileSync(new URL('../src/routes/task.routes.js', import.meta.url), 'utf8');
  const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  assert.match(routes, /taskNumber: parseInt\(req\.params\.taskNumber\), tenantId: req\.user\.tenantId/);
  assert.match(routes, /id: deviceId, \.\.\.\(req\.user\.tenantId && \{ tenantId: req\.user\.tenantId \}\)/);
  assert.match(server, /Chat com agentes é restrito à equipe global do NOC/);
});

test('gera PDF mensal válido a partir do snapshot isolado', async () => {
  const reportData = {
    summary: { total: 3, resolved: 2, resolutionRate: 66.7, mttaSeconds: 60, mttrSeconds: 300, slaCompliance: 100, slaBreached: 0 },
    workTypes: { incidents: 1, consultations: 1, configurations: 1 },
    topDevices: [{ name: 'Roteador do cliente', incidents: 1, critical: 0, resolved: 1 }],
  };
  const pdf = await monthlyReportPdf({ periodKey: '2026-06', periodFrom: new Date('2026-06-01T04:00:00Z'), periodTo: new Date('2026-07-01T03:59:59Z'), tenant: { name: 'Cliente A' }, reportData: JSON.stringify(reportData) });
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
  assert.ok(pdf.length > 1000);
});
