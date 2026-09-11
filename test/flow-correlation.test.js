import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateFlowRisk, correlateFlowAnomalies, flowCorrelationKind } from '../src/services/flow-correlation.service.js';

const now = new Date(), base = { status:'confirmed', severity:'high', confidence:80, consecutiveCount:3, packets:20000, bytes:20000000, firstSeenAt:now, lastSeenAt:now, protocol:'tcp', port:22 };

test('correlaciona uma origem observada em equipamentos diferentes',()=>{
  const a={...base,id:'a',exporterName:'R1',sourceAddress:'45.1.1.1',destinationAddress:'10.0.0.1'},b={...base,id:'b',exporterName:'R2',sourceAddress:'45.1.1.1',destinationAddress:'10.0.0.2'};
  assert.equal(flowCorrelationKind(a,b),'multi_target');
  const groups=correlateFlowAnomalies([a,b]); assert.equal(groups.length,1); assert.equal(groups[0].eventCount,2); assert.deepEqual(groups[0].exporters,['R1','R2']);
});

test('correlaciona origens distintas contra o mesmo serviço',()=>{
  const a={...base,id:'a',exporterName:'R1',sourceAddress:'45.1.1.1',destinationAddress:'10.0.0.1'},b={...base,id:'b',exporterName:'R1',sourceAddress:'46.1.1.1',destinationAddress:'10.0.0.1'};
  assert.equal(flowCorrelationKind(a,b),'distributed'); assert.equal(correlateFlowAnomalies([a,b])[0].kind,'distributed');
});

test('correlação e criticidade elevam a pontuação sem ultrapassar 100',()=>{
  const plain=calculateFlowRisk(base),correlated=calculateFlowRisk(base,{relatedEvents:8,exporters:3,sources:9,protectedDestination:true,criticality:'critical'});
  assert.ok(correlated.score>plain.score); assert.ok(correlated.score<=100); assert.equal(correlated.level,'critical');
});
