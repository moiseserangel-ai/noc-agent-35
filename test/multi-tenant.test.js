import test from'node:test';import assert from'node:assert/strict';import{globalOnly}from'../src/middleware/auth.middleware.js';
test('usuário global acessa módulos administrativos',()=>{let next=false;globalOnly({user:{tenantId:null}},{},()=>{next=true;});assert.equal(next,true);});
test('usuário de cliente é bloqueado em módulos globais',()=>{let status,body;globalOnly({user:{tenantId:'cliente-a'}},{status(value){status=value;return this;},json(value){body=value;}},()=>{});assert.equal(status,403);assert.match(body.error,/equipe global/);});
