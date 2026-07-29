import test from 'node:test';
import assert from 'node:assert/strict';
import { validateUniFiOperation } from '../src/tools/unifi-controller.tool.js';
import { getDeviceTypeLabel, supportedDeviceTypes } from '../src/vendors/registry.js';

test('plugin UniFi Controller está registrado',()=>{
  assert.ok(supportedDeviceTypes.includes('unifi_controller'));
  assert.equal(getDeviceTypeLabel('unifi_controller'),'Ubiquiti UniFi Controller');
});

test('UniFi permite somente consultas previstas',()=>{
  for(const operation of ['status','sites','devices','clients','alarms'])assert.equal(validateUniFiOperation(operation).allowed,true);
  assert.equal(validateUniFiOperation('configure').allowed,false);
  assert.equal(validateUniFiOperation('/api/cmd/devmgr').allowed,false);
});
