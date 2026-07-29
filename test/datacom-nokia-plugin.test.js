import test from 'node:test';
import assert from 'node:assert/strict';
import { addProfiledDescriptions, validateProfiledCommands } from '../src/tools/ssh-profiled-network.tool.js';
import { supportedDeviceTypes } from '../src/vendors/registry.js';

test('registra Datacom DMOS e Nokia SR OS',()=>{
  assert.ok(supportedDeviceTypes.includes('datacom_dmos'));
  assert.ok(supportedDeviceTypes.includes('nokia_sros'));
});
test('permite leitura e protege mudanças Datacom',()=>{
  assert.equal(validateProfiledCommands('datacom_dmos','show version',false).allowed,true);
  assert.equal(validateProfiledCommands('datacom_dmos','configure terminal',false).allowed,false);
  assert.equal(validateProfiledCommands('datacom_dmos','reload',true).allowed,false);
});
test('permite leitura e protege mudanças Nokia',()=>{
  assert.equal(validateProfiledCommands('nokia_sros','show version',false).allowed,true);
  assert.equal(validateProfiledCommands('nokia_sros','/configure router',false).allowed,false);
  assert.equal(validateProfiledCommands('nokia_sros','admin reboot',true).allowed,false);
});
test('adiciona description Datacom e Nokia',()=>{
  assert.match(addProfiledDescriptions('datacom_dmos','interface ethernet 1/1','Uplink NOC principal'),/description Uplink NOC principal/);
  assert.match(addProfiledDescriptions('nokia_sros','configure port 1/1/1','Uplink NOC principal'),/description "Uplink NOC principal"/);
});
