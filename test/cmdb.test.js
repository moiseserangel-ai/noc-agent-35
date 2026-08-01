import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CMDB_CATEGORIES, CMDB_CRITICALITIES, CMDB_STATUSES, normalizeCmdbAsset } from '../src/services/cmdb.service.js';

test('catálogo CMDB cobre ativos, ciclo de vida e criticidade', () => {
  assert.ok(CMDB_CATEGORIES.includes('network'));
  assert.ok(CMDB_CATEGORIES.includes('server'));
  assert.ok(CMDB_CATEGORIES.includes('circuit'));
  assert.deepEqual(CMDB_STATUSES, ['active','spare','maintenance','retired','disposed']);
  assert.ok(CMDB_CRITICALITIES.includes('critical'));
});

test('normaliza ativo independente com patrimônio automático', async () => {
  const asset = await normalizeCmdbAsset({ name:'Servidor de monitoramento', category:'server', criticality:'high', cost:'12500.50', currency:'brl', warrantyUntil:'2027-12-31' }, 'Administrador');
  assert.match(asset.assetTag, /^AT-[A-F0-9]{8}$/);
  assert.equal(asset.cost, 12500.5);
  assert.equal(asset.currency, 'BRL');
  assert.equal(asset.updatedBy, 'Administrador');
});

test('rejeita datas e valores patrimoniais inválidos', async () => {
  await assert.rejects(() => normalizeCmdbAsset({ name:'Ativo', cost:'-1' }, 'Admin'), /Valor de aquisição/);
  await assert.rejects(() => normalizeCmdbAsset({ name:'Ativo', purchaseDate:'invalida' }, 'Admin'), /Data inválida/);
});

test('API CMDB permanece administrativa e auditada nesta fase', () => {
  const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
  const routes=fs.readFileSync(new URL('../src/routes/cmdb.routes.js',import.meta.url),'utf8');
  assert.match(server,/app\.use\('\/api\/cmdb',authMiddleware,globalOnly,requireRoles\('admin'\)/);
  assert.match(routes,/resource:'cmdb_asset'/);
  assert.match(routes,/cmdbAsset: \{ is: null \}/);
});
