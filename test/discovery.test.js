import test from 'node:test';
import assert from 'node:assert/strict';
import { expandPrivateCidr, identifyDiscoveredHost, normalizeDiscoveryPorts } from '../src/services/discovery.service.js';

test('expande somente CIDR privado limitado a 256 endereços',()=>{
  const hosts=expandPrivateCidr('192.168.10.0/24');
  assert.equal(hosts.length,254);
  assert.equal(hosts[0],'192.168.10.1');
  assert.equal(hosts.at(-1),'192.168.10.254');
  assert.throws(()=>expandPrivateCidr('8.8.8.0/24'),/privadas/);
  assert.throws(()=>expandPrivateCidr('10.0.0.0/16'),/256/);
});

test('restringe portas de descoberta à lista autorizada',()=>{
  assert.deepEqual(normalizeDiscoveryPorts([22,8291,22,9999]),[22,8291]);
  assert.ok(normalizeDiscoveryPorts([]).includes(8728));
});

test('identifica MikroTik por Winbox e Huawei pelo banner SSH',()=>{
  assert.deepEqual(identifyDiscoveredHost([22,8291],'SSH-2.0'),{detectedType:'mikrotik',manufacturer:'MikroTik',confidence:95});
  assert.equal(identifyDiscoveredHost([22],'SSH-2.0-HUAWEI-VRP').detectedType,'huawei_vrp');
});
