import test from 'node:test';
import assert from 'node:assert/strict';
import { publicMitigationTarget } from '../src/services/flow-mitigation.service.js';

test('mitigação aceita somente IPv4 público não reservado', () => {
  assert.equal(publicMitigationTarget('45.33.32.156'), true);
  for (const ip of ['10.0.0.1','172.16.0.1','192.168.1.1','100.64.0.1','8.8.8.8','192.0.2.1','198.51.100.2','203.0.113.3','224.0.0.1']) assert.equal(publicMitigationTarget(ip), false, ip);
});
