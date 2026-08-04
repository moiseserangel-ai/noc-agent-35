import test from'node:test';import assert from'node:assert/strict';import{expiryStage}from'../src/services/commercial-expiry.service.js';
const now=new Date('2026-08-04T12:00:00Z');
test('classifica estágios e severidade de vencimento',()=>{assert.deepEqual(expiryStage('2026-08-10T12:00:00Z',30,now),{days:6,stage:'7d',severity:'critical'});assert.equal(expiryStage('2026-08-24T12:00:00Z',30,now).stage,'30d');assert.equal(expiryStage('2026-08-03T12:00:00Z',30,now).stage,'expired')});
test('respeita janela configurada inclusive zero',()=>{assert.equal(expiryStage('2026-08-10T12:00:00Z',5,now),null);assert.equal(expiryStage('2026-08-05T12:00:00Z',0,now),null)});
