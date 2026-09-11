import test from'node:test';
import assert from'node:assert/strict';
import{globalOnly}from'../src/middleware/auth.middleware.js';
import{tenantSlaValue}from'../src/services/sla.service.js';
import{teamsForTenant}from'../src/services/on-call.service.js';

test('usuário global acessa módulos administrativos',()=>{
  let next=false;globalOnly({user:{tenantId:null}},{},()=>{next=true;});assert.equal(next,true);
});
test('usuário de cliente é bloqueado em módulos globais',()=>{
  let status,body;globalOnly({user:{tenantId:'cliente-a'}},{status(value){status=value;return this;},json(value){body=value;}},()=>{});
  assert.equal(status,403);assert.match(body.error,/equipe global/);
});
test('SLA do contrato sobrescreve o global e aceita herança',()=>{
  assert.equal(tenantSlaValue({slaCriticalAck:2},'slaCriticalAck',5),2);
  assert.equal(tenantSlaValue({slaCriticalAck:null},'slaCriticalAck',5),5);
});
test('plantão nunca mistura equipes de clientes',()=>{
  const teams=[{id:'global',tenantId:null,enabled:true},{id:'a',tenantId:'a',enabled:true},{id:'b',tenantId:'b',enabled:true}];
  assert.deepEqual(teamsForTenant(teams,'a').map(item=>item.id),['a']);
  assert.deepEqual(teamsForTenant(teams,null).map(item=>item.id),['global']);
});
