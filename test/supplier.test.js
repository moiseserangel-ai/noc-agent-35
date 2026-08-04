import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSupplier} from '../src/routes/supplier.routes.js';

test('normaliza fornecedor global e avaliação',()=>{const row=normalizeSupplier({name:' Integrador NOC ',website:'https://example.com',rating:5,manufacturers:'MikroTik, Huawei'});assert.equal(row.name,'Integrador NOC');assert.equal(row.tenantId,null);assert.equal(row.rating,5);});
test('rejeita fornecedor sem nome, site inseguro e avaliação inválida',()=>{assert.throws(()=>normalizeSupplier({}),/nome/);assert.throws(()=>normalizeSupplier({name:'Fornecedor',website:'http://example.com'}),/HTTPS/);assert.throws(()=>normalizeSupplier({name:'Fornecedor',rating:6}),/1 a 5/);});
