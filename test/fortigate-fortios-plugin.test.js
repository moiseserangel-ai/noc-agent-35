import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureFortiGatePolicyComments, validateFortiGateCommands } from '../src/tools/ssh-fortigate-fortios.tool.js';
import { getDeviceTypeLabel, supportedDeviceTypes } from '../src/vendors/registry.js';
import { evaluateFortiGateCompliance } from '../src/services/compliance.service.js';

test('plugin FortiGate está registrado',()=>{
  assert.ok(supportedDeviceTypes.includes('fortigate_fortios'));
  assert.equal(getDeviceTypeLabel('fortigate_fortios'),'Fortinet FortiGate / FortiOS');
});

test('política FortiOS permite consulta e exige aprovação para mudança',()=>{
  assert.equal(validateFortiGateCommands('get system status\nshow firewall policy',false).allowed,true);
  assert.equal(validateFortiGateCommands('config firewall policy\nedit 1',false).allowed,false);
  assert.equal(validateFortiGateCommands('config firewall policy\nedit 1',true).allowed,true);
});

test('política FortiOS bloqueia comandos destrutivos',()=>{
  assert.equal(validateFortiGateCommands('execute reboot',true).allowed,false);
  assert.equal(validateFortiGateCommands('execute factoryreset',true).allowed,false);
});

test('adiciona comments em política FortiGate',()=>{
  const result=ensureFortiGatePolicyComments('config firewall policy\nedit 10\nset action accept\nnext\nend','Liberação do servidor NOC');
  assert.match(result,/set comments "Liberação do servidor NOC"\nnext/);
});

test('avalia controles essenciais FortiOS',()=>{
  const findings=evaluateFortiGateCompliance('set hostname FGT-EDGE\nset allowaccess ping https ssh\nset ntpsync enable\nset admintimeout 10');
  assert.equal(findings.find(item=>item.ruleKey==='fg_hostname').status,'compliant');
  assert.equal(findings.find(item=>item.ruleKey==='fg_ntp').status,'compliant');
});
