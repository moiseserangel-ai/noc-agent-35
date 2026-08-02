import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDiscoveredAddresses } from '../src/services/ipam-reconciliation.service.js';

test('descobre endereços MikroTik e calcula rede e VLAN',()=>{const rows=parseDiscoveredAddresses('mikrotik',' 0 address=192.168.40.1/24 network=192.168.40.0 interface=vlan400\n 1 address=10.0.0.1/30 interface=ether1');assert.deepEqual(rows.map(x=>[x.addressIp,x.cidr,x.vlanId]),[['192.168.40.1','192.168.40.0/24',400],['10.0.0.1','10.0.0.0/30',null]]);});
test('descobre endereços Huawei e Cisco',()=>{const h=parseDiscoveredAddresses('huawei_vrp','Vlanif200  172.16.2.1/24 up up');assert.equal(h[0].cidr,'172.16.2.0/24');assert.equal(h[0].vlanId,200);const c=parseDiscoveredAddresses('cisco_ios','interface Vlan300\n ip address 10.30.0.1 255.255.255.0');assert.equal(c[0].cidr,'10.30.0.0/24');assert.equal(c[0].vlanId,300);});
