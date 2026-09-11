import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeLatencyBaseline, diagnoseLinkAnomaly, shouldRequestSpecialistAnalysis } from '../src/services/topology-telemetry.service.js';

test('aprende baseline robusto e detecta aumento anormal', () => {
  const history = [10, 11, 9, 10, 12, 10, 11, 9, 10, 80].map(latencyMs => ({ latencyMs }));
  const normal = analyzeLatencyBaseline(history, 18);
  const anomaly = analyzeLatencyBaseline(history, 45);
  assert.equal(normal.latencyAnomaly, false);
  assert.equal(anomaly.latencyAnomaly, true);
  assert.ok(anomaly.baselineLatencyMs >= 9 && anomaly.baselineLatencyMs <= 12);
});

test('aciona especialista somente em cenário crítico ou ambíguo', () => {
  assert.equal(shouldRequestSpecialistAnalysis({ priority: 'critical' }, { latencyAnomaly: false }), true);
  assert.equal(shouldRequestSpecialistAnalysis({ priority: 'high' }, { latencyAnomaly: true, anomalyReason: 'Aumento anormal; verificar rota e operadora' }), true);
  assert.equal(shouldRequestSpecialistAnalysis({ priority: 'high' }, { latencyAnomaly: true, anomalyReason: 'Provável congestionamento do link' }), false);
  assert.equal(shouldRequestSpecialistAnalysis({ priority: 'high' }, { latencyAnomaly: false }), false);
});

test('aguarda amostras suficientes e classifica causa provável', () => {
  assert.equal(analyzeLatencyBaseline([{ latencyMs: 10 }], 100).latencyAnomaly, false);
  assert.equal(diagnoseLinkAnomaly({ latencyAnomaly: true, utilization: 88, packetLoss: 0 }), 'Provável congestionamento do link');
  assert.equal(diagnoseLinkAnomaly({ latencyAnomaly: true, utilization: 20, packetLoss: 8 }), 'Instabilidade ou perda de pacotes');
});
