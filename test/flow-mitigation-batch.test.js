import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFlowBatchIds } from '../src/services/flow-mitigation.service.js';

test('lote aceita de dois a dez itens únicos',()=>{
  assert.deepEqual(normalizeFlowBatchIds([' a ','b','a']),['a','b']);
  assert.equal(normalizeFlowBatchIds(Array.from({length:10},(_,i)=>String(i))).length,10);
  assert.throws(()=>normalizeFlowBatchIds(['a']));
  assert.throws(()=>normalizeFlowBatchIds(Array.from({length:11},(_,i)=>String(i))));
});
