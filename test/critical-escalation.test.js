import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCriticalEscalation } from '../src/services/notification.service.js';

const now=new Date('2026-07-30T14:00:00Z');
const opened=minutes=>new Date(now.getTime()-minutes*60_000);

test('escalonamento crítico avança progressivamente pelos três níveis',()=>{
  assert.equal(evaluateCriticalEscalation(opened(6),0,[5,15,30],now),1);
  assert.equal(evaluateCriticalEscalation(opened(16),1,[5,15,30],now),2);
  assert.equal(evaluateCriticalEscalation(opened(31),2,[5,15,30],now),3);
});

test('escalonamento crítico não repete nível já registrado',()=>{
  assert.equal(evaluateCriticalEscalation(opened(10),1,[5,15,30],now),0);
  assert.equal(evaluateCriticalEscalation(opened(40),3,[5,15,30],now),0);
});

test('escalonamento crítico recupera diretamente o nível correspondente após interrupção',()=>{
  assert.equal(evaluateCriticalEscalation(opened(40),0,[5,15,30],now),3);
});
