import test from 'node:test';
import assert from 'node:assert/strict';
import { correlateNeighbor, parseHuaweiLldpBrief, parseMikrotikNeighbors } from '../src/services/topology-discovery.service.js';

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
