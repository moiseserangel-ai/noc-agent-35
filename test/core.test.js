import test from 'node:test';
import assert from 'node:assert/strict';
import { inferWorkType } from '../src/services/work-type.service.js';
import { generateTotpSecret, totpCode, verifyTotp } from '../src/services/totp.service.js';
import { evaluateTaskSla } from '../src/services/sla.service.js';
import { resolveReportPeriod } from '../src/services/report.service.js';
import prisma from '../src/database/client.js';

test.after(async () => prisma.$disconnect());

test('classifica atividades operacionais', () => {
  assert.equal(inferWorkType('Interface caiu e está sem acesso', 'dashboard'), 'incident');
  assert.equal(inferWorkType('Liste os endereços IP', 'whatsapp'), 'consultation');
  assert.equal(inferWorkType('Configure uma nova VLAN', 'dashboard'), 'configuration');
  assert.equal(inferWorkType('qualquer conteúdo', 'zabbix'), 'incident');
});

test('gera e valida código TOTP', () => {
  const secret = generateTotpSecret();
  const code = totpCode(secret);
  assert.match(code, /^\d{6}$/);
  assert.equal(verifyTotp(secret, code), true);
  assert.equal(verifyTotp(secret, '000000') && code !== '000000', false);
});

test('detecta violação de SLA', () => {
  const now = new Date('2026-07-22T12:00:00Z');
  const result = evaluateTaskSla({ status:'pending', createdAt:'2026-07-22T10:00:00Z', slaAckDueAt:'2026-07-22T10:15:00Z', slaResolveDueAt:'2026-07-22T11:00:00Z' }, now);
  assert.equal(result.ackBreached, true);
  assert.equal(result.resolutionBreached, true);
});

test('limita período de relatório', () => {
  const period = resolveReportPeriod({ from:'2026-07-01', to:'2026-07-22' });
  assert.ok(period.from < period.to);
  assert.throws(() => resolveReportPeriod({ from:'2025-01-01', to:'2026-07-22' }), /máximo/);
});
