import test from 'node:test';
import assert from 'node:assert/strict';
import { correlateNeighbor, parseCiscoNeighbors, parseDatacomNeighbors, parseFortiGateNeighbors, parseHuaweiLldpBrief, parseJuniperNeighbors, parseMikrotikNeighbors, parseNokiaNeighbors } from '../src/services/topology-discovery.service.js';

test('interpreta vizinhos MNDP e LLDP do RouterOS',()=>{
  const rows=parseMikrotikNeighbors(` 0 interface=ether1 address=10.0.0.2 address4=10.0.0.2 mac-address=AA:BB:CC:DD:EE:FF identity="RB-Core" platform="MikroTik" interface-name="ether2" discovered-by=lldp,mndp\n 1 interface=ether5 address4=10.0.0.3 identity=SW-Edge discovered-by=mndp`);
  assert.equal(rows.length,2);
  assert.equal(rows[0].protocol,'lldp');
  assert.equal(rows[0].remoteName,'RB-Core');
  assert.equal(rows[1].protocol,'mndp');
});

test('interpreta tabela LLDP resumida do Huawei VRP',()=>{
  const rows=parseHuaweiLldpBrief(`Local Intf   Neighbor Dev             Neighbor Intf             Exptime\nGE0/0/1      NE8000-Core              GE1/0/2                   103\nXGE0/0/2     SW-Access                XGE0/0/1                  88`);
  assert.equal(rows.length,2);
  assert.equal(rows[0].localInterface,'GE0/0/1');
  assert.equal(rows[0].remoteName,'NE8000-Core');
});

test('correlaciona primeiro por IP e depois por identidade',()=>{
  const devices=[{id:'a',name:'RB Local',hostname:'10.0.0.1'},{id:'b',name:'NE8000 Core',hostname:'10.0.0.2'}];
  assert.deepEqual(correlateNeighbor({remoteIp:'10.0.0.2'},devices,'a'),{deviceId:'b',confidence:100});
  assert.deepEqual(correlateNeighbor({remoteName:'NE8000-Core'},devices,'a'),{deviceId:'b',confidence:95});
});

test('interpreta vizinhos CDP e LLDP Cisco',()=>{
  const rows=parseCiscoNeighbors(`Device ID: SW-CORE\nEntry address(es):\n  IP address: 10.0.0.2\nPlatform: cisco C9300, Capabilities: Switch\nInterface: GigabitEthernet1/0/1, Port ID (outgoing port): GigabitEthernet1/0/48\n\nSystem Name: AP-01\nLocal Interface: Gi1/0/2\nPort id: eth0\nManagement Address: 10.0.0.3`);
  assert.equal(rows.length,2);
  assert.equal(rows[0].protocol,'cdp');
  assert.equal(rows[0].remoteInterface,'GigabitEthernet1/0/48');
  assert.equal(rows[1].protocol,'lldp');
});

test('interpreta vizinhos LLDP Juniper',()=>{
  const rows=parseJuniperNeighbors(`Local Interface    Parent Interface    Chassis Id          Port info          System Name
ge-0/0/0.0         -                   aa:bb:cc:dd:ee:ff   Gi1/0/48           SW-CORE
xe-0/0/1.0         -                   11:22:33:44:55:66   et-0/0/0           MX-EDGE`);
  assert.equal(rows.length,2);
  assert.equal(rows[0].localInterface,'ge-0/0/0.0');
  assert.equal(rows[0].remoteName,'SW-CORE');
  assert.equal(rows[0].remoteInterface,'Gi1/0/48');
});

test('interpreta vizinhos LLDP FortiGate',()=>{
  const rows=parseFortiGateNeighbors(`Interface: port1
Chassis ID: aa:bb:cc:dd:ee:ff
System Name: SW-CORE
Port ID: Gi1/0/48
Management Address: 10.0.0.2`);
  assert.equal(rows.length,1);
  assert.equal(rows[0].remoteName,'SW-CORE');
  assert.equal(rows[0].remoteInterface,'Gi1/0/48');
});

test('interpreta vizinhos LLDP Datacom e Nokia',()=>{
  const datacom=parseDatacomNeighbors(`Local Interface: ethernet 1/1\nSystem Name: SW-CORE\nPort ID: Gi1/0/48\nManagement Address: 10.0.0.2`);
  assert.equal(datacom[0].remoteName,'SW-CORE');
  const nokia=parseNokiaNeighbors(`Local Port: 1/1/1\nSystem Name: PE-02\nPort Description: 1/1/2\nManagement Address: 10.0.0.3`);
  assert.equal(nokia[0].remoteInterface,'1/1/2');
});
