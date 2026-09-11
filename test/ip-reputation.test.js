import test from 'node:test';
import assert from 'node:assert/strict';
import { reputationEligibleIp, reputationRiskPoints } from '../src/services/ip-reputation.service.js';

test('reputação aumenta o risco de forma proporcional',()=>{
  assert.equal(reputationRiskPoints({abuseConfidenceScore:0}),0);
  assert.equal(reputationRiskPoints({abuseConfidenceScore:45}),9);
  assert.equal(reputationRiskPoints({abuseConfidenceScore:75}),15);
  assert.equal(reputationRiskPoints({abuseConfidenceScore:95}),20);
});
test('consulta externa recusa endereços internos e reservados',()=>{
  assert.equal(reputationEligibleIp('45.33.32.156'),true);
  for(const ip of ['10.0.0.1','192.168.1.1','192.0.2.1','198.51.100.1','203.0.113.1']) assert.equal(reputationEligibleIp(ip),false,ip);
});
