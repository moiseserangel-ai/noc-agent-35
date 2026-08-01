import test from 'node:test';
import assert from 'node:assert/strict';
import { addressInSubnet, normalizeSubnet, parseCidr } from '../src/services/ipam.service.js';

test('normaliza CIDR e calcula capacidade IPv4',()=>{const row=parseCidr('192.168.10.25/24');assert.equal(row.cidr,'192.168.10.0/24');assert.equal(row.capacity,254);assert.equal(row.first,'192.168.10.1');assert.equal(row.last,'192.168.10.254');});
test('valida VLAN, gateway e endereço pertencente à rede',()=>{const row=normalizeSubnet({name:'Gerência',cidr:'10.20.0.0/23',gateway:'10.20.0.1',vlanId:400});assert.equal(row.vlanId,400);assert.equal(addressInSubnet('10.20.1.250',parseCidr(row.cidr)),true);assert.throws(()=>normalizeSubnet({cidr:'10.0.0.0/24',gateway:'10.1.0.1'}),/Gateway/);});
test('rejeita IPv4 e prefixo inválidos',()=>{assert.throws(()=>parseCidr('300.1.1.1/24'),/IPv4/);assert.throws(()=>parseCidr('10.0.0.0/40'),/CIDR/);});
test('erro de validação IPAM retorna HTTP 400 e orientação de CIDR',()=>{assert.throws(()=>parseCidr('192.168.250.10'),error=>error.statusCode===400&&/192\.168\.250\.0\/24/.test(error.message));});
