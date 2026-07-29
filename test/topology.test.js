import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultPosition, topologyStatus } from '../src/services/topology.service.js';

test('topologia prioriza incidente crítico sobre disponibilidade', () => {
  assert.equal(topologyStatus({ availability: 100 }, [{ priority: 'critical' }]), 'critical');
});

test('topologia representa alerta, indisponibilidade e estado desconhecido', () => {
  assert.equal(topologyStatus({ availability: 100 }, [{ priority: 'high' }]), 'warning');
  assert.equal(topologyStatus({ availability: 0 }, []), 'offline');
  assert.equal(topologyStatus(null, []), 'unknown');
});

test('posição automática distribui equipamentos em grade', () => {
  assert.deepEqual(defaultPosition(0, 10), { x: 110, y: 100 });
  assert.notDeepEqual(defaultPosition(0, 10), defaultPosition(5, 10));
});
