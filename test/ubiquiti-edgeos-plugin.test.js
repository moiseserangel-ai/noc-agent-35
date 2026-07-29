import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureEdgeOsDescriptions, validateEdgeOsCommands } from '../src/tools/ssh-ubiquiti-edgeos.tool.js';
import { getDeviceTypeLabel, supportedDeviceTypes } from '../src/vendors/registry.js';
import { evaluateEdgeOsCompliance } from '../src/services/compliance.service.js';

test('plugin EdgeOS está registrado',()=>{assert.ok(supportedDeviceTypes.includes('ubiquiti_edgeos'));assert.equal(getDeviceTypeLabel('ubiquiti_edgeos'),'Ubiquiti EdgeRouter / EdgeOS');});
test('política EdgeOS protege alterações',()=>{assert.equal(validateEdgeOsCommands('show version',false).allowed,true);assert.equal(validateEdgeOsCommands('configure\nset system host-name EDGE',false).allowed,false);assert.equal(validateEdgeOsCommands('configure\nset system host-name EDGE',true).allowed,true);assert.equal(validateEdgeOsCommands('reboot',true).allowed,false);});
test('adiciona descrição em interface EdgeOS',()=>{assert.match(ensureEdgeOsDescriptions('set interfaces ethernet eth0 address 10.0.0.1/24','Link principal NOC'),/set interfaces ethernet eth0 description "Link principal NOC"/);});
test('avalia baseline EdgeOS',()=>{const rows=evaluateEdgeOsCompliance('set system host-name EDGE-01\nset service ssh port 22\nset system ntp server 10.0.0.1');assert.equal(rows.find(item=>item.ruleKey==='eo_ssh').status,'compliant');});
