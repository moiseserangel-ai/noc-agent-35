import test from 'node:test';
import assert from 'node:assert/strict';
import { formatChangeMarker, normalizeChangeComment } from '../src/services/device-change.service.js';

test('normaliza e identifica comentário de mudança', () => {
  assert.equal(normalizeChangeComment('  VLAN 400\nativada para o cliente  '), 'VLAN 400 ativada para o cliente');
  assert.equal(formatChangeMarker('VLAN 400 ativada', 123), 'NOC-Agent #TASK-123 — VLAN 400 ativada');
});

test('rejeita comentário ausente ou insuficiente', () => {
  assert.throws(() => normalizeChangeComment('feito'), /pelo menos 10/);
});
