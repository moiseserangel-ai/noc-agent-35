import test from'node:test';import assert from'node:assert/strict';import{normalizeCommercialContract}from'../src/routes/commercial-contract.routes.js';
const base={number:'CT-1',title:'Suporte',tenantId:'t1',supplierId:'s1',startDate:'2026-01-01',endDate:'2026-12-31',amount:12000,documentUrl:'https://example.com/contrato.pdf',assetIds:['a1','a1']};
test('normaliza contrato e remove ativos duplicados',()=>{const row=normalizeCommercialContract(base);assert.equal(row.amount,12000);assert.deepEqual(row.assetIds,['a1']);});
test('rejeita datas invertidas e documento inseguro',()=>{assert.throws(()=>normalizeCommercialContract({...base,endDate:'2025-01-01'}),/posterior/);assert.throws(()=>normalizeCommercialContract({...base,documentUrl:'http://example.com'}),/HTTPS/);});
