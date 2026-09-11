import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldStopBatch } from '../src/services/runbook-batch.service.js';

test('interrompe novas ondas quando falhas atingem vinte por cento',()=>{
  assert.equal(shouldStopBatch(1,5,20),true);
  assert.equal(shouldStopBatch(1,6,20),false);
  assert.equal(shouldStopBatch(0,3,20),false);
});

test('não calcula taxa antes de processar equipamentos',()=>{
  assert.equal(shouldStopBatch(0,0,20),false);
});
