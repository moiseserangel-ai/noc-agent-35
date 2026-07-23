import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCliCommand } from '../src/services/cli.service.js';

test('classifica consultas dos três fabricantes como leitura', () => {
  assert.equal(classifyCliCommand('mikrotik', '/interface print').type, 'read');
  assert.equal(classifyCliCommand('huawei_vrp', 'display interface brief').type, 'read');
  assert.equal(classifyCliCommand('linux', 'systemctl status nginx').type, 'read');
});

test('classifica configurações como alteração', () => {
  assert.equal(classifyCliCommand('mikrotik', '/interface ethernet set ether1 disabled=yes').type, 'change');
  assert.equal(classifyCliCommand('huawei_vrp', 'system-view\ninterface GigabitEthernet0/0/1\nshutdown').type, 'change');
  assert.equal(classifyCliCommand('linux', 'systemctl restart nginx').type, 'change');
});

test('rejeita comando vazio e fabricante não suportado', () => {
  assert.equal(classifyCliCommand('linux', '').valid, false);
  assert.equal(classifyCliCommand('cisco', 'show version').valid, false);
});
