import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureCiscoNativeDescriptions, validateCiscoCommands } from '../src/tools/ssh-cisco-ios.tool.js';
import { classifyCliCommand } from '../src/services/cli.service.js';
import { vendorPlugins } from '../src/vendors/registry.js';
import { evaluateCiscoCompliance } from '../src/services/compliance.service.js';

test('plugin Cisco IOS está registrado e possui terminal',()=>{
  assert.ok(vendorPlugins.some(item=>item.type==='cisco_ios'));
  assert.equal(classifyCliCommand('cisco_ios','show ip route').type,'read');
  assert.equal(classifyCliCommand('cisco_ios','configure terminal').type,'change');
});

test('política Cisco permite leitura e bloqueia alteração sem aprovação',()=>{
  assert.equal(validateCiscoCommands('show version',false).allowed,true);
  assert.equal(validateCiscoCommands(`configure terminal
interface Gi1/0/1`,false).allowed,false);
  assert.equal(validateCiscoCommands('reload',true).allowed,false);
});

test('injeta description Cisco em interface sem substituir descrição explícita',()=>{
  assert.match(ensureCiscoNativeDescriptions(`interface Gi1/0/1
no shutdown`,'Link principal NOC'),/description Link principal NOC/);
  const explicit=ensureCiscoNativeDescriptions(`interface Gi1/0/1
description Uplink atual
no shutdown`,'Link principal NOC');
  assert.equal((explicit.match(/description/g)||[]).length,1);
  assert.match(explicit,/description Uplink atual/);
});

test('avalia baseline de segurança Cisco IOS-XE',()=>{
  const findings=evaluateCiscoCompliance(`hostname SW-CORE\nip ssh version 2\nno ip http server\nntp server 10.0.0.10\nlogging host 10.0.0.20\naaa new-model\nline vty 0 15\n access-class MGMT in\n transport input ssh`);
  assert.equal(findings.find(item=>item.ruleKey==='cs_ssh_v2').status,'compliant');
  assert.equal(findings.find(item=>item.ruleKey==='cs_transport_ssh').status,'compliant');
});
