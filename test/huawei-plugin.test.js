import test from 'node:test';
import assert from 'node:assert/strict';
import { validateHuaweiCommands } from '../src/tools/ssh-huawei-vrp.tool.js';
import { supportedDeviceTypes, getDeviceTypeLabel } from '../src/vendors/registry.js';

test('plugin Huawei está registrado', () => {
  assert.ok(supportedDeviceTypes.includes('huawei_vrp'));
  assert.equal(getDeviceTypeLabel('huawei_vrp'), 'Huawei VRP / NetEngine');
});

test('política Huawei permite diagnóstico e exige aprovação para alteração', () => {
  assert.equal(validateHuaweiCommands('display version\ndisplay bgp peer', false).allowed, true);
  assert.equal(validateHuaweiCommands('system-view\ninterface 100GE1/0/0', false).allowed, false);
  assert.equal(validateHuaweiCommands('system-view\ninterface 100GE1/0/0', true).allowed, true);
});

test('política Huawei bloqueia comandos destrutivos mesmo aprovados', () => {
  assert.equal(validateHuaweiCommands('reboot', true).allowed, false);
  assert.equal(validateHuaweiCommands('reset saved-configuration', true).allowed, false);
});
