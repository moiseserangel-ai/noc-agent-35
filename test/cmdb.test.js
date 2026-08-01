import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CMDB_CATEGORIES, CMDB_CRITICALITIES, CMDB_STATUSES, normalizeCmdbAsset } from '../src/services/cmdb.service.js';
import { nextInventoryAt, parseInventoryOutput } from '../src/services/cmdb-inventory.service.js';
import { calculateImpact, CMDB_RELATIONSHIP_TYPES, relationshipImpactEdges } from '../src/services/cmdb-relationship.service.js';

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

test('interpreta inventário MikroTik, Huawei e Cisco sem IA', () => {
  const mikrotik=parseInventoryOutput('mikrotik','uptime: 2d3h\nversion: 7.19.3\nboard-name: RB3011UiAS\nserial-number: ABC123\nname: RB-CORE');
  assert.deepEqual([mikrotik.model,mikrotik.serialNumber,mikrotik.osVersion],['RB3011UiAS','ABC123','7.19.3']);
  const huawei=parseInventoryOutput('huawei_vrp','Huawei Versatile Routing Platform Software\nVRP (R) software, Version 8.230\nHUAWEI NE8000 uptime is 10 days\nESN: 2102ABC');
  assert.equal(huawei.model,'NE8000');assert.equal(huawei.serialNumber,'2102ABC');
  const cisco=parseInventoryOutput('cisco_ios','Cisco IOS XE Software, Version 17.09.04a\nCisco C8300-1N1S-6T (1RU) processor\nProcessor board ID FDO1234\nR1 uptime is 4 days');
  assert.equal(cisco.model,'C8300-1N1S-6T');assert.equal(cisco.serialNumber,'FDO1234');
});

test('agenda coleta diária e semanal sempre no futuro',()=>{
  const now=new Date('2026-08-01T10:30:00-04:00');
  assert.ok(nextInventoryAt({frequency:'daily',hour:3},now)>now);
  assert.ok(nextInventoryAt({frequency:'weekly',hour:3,weekday:1},now)>now);
});

test('coleta utiliza somente comandos de consulta permitidos',()=>{
  const source=fs.readFileSync(new URL('../src/services/cmdb-inventory.service.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/configure terminal|system-view|\/system reset|write memory/);
  assert.match(source,/display version/);assert.match(source,/show version/);assert.match(source,/\/system resource print/);
});

test('catálogo de relações cobre dependência, conectividade e hospedagem',()=>{
  assert.ok(CMDB_RELATIONSHIP_TYPES.includes('depends_on'));
  assert.ok(CMDB_RELATIONSHIP_TYPES.includes('connected_to'));
  assert.ok(CMDB_RELATIONSHIP_TYPES.includes('hosted_on'));
});

test('calcula impacto direto e em cascata sem repetir ativos',()=>{
  const assets=[{id:'host',name:'Hypervisor',criticality:'critical'},{id:'vm',name:'Zabbix',criticality:'high'},{id:'noc',name:'NOC Agent',criticality:'high'}];
  const relationships=[
    {id:'r1',sourceAssetId:'vm',targetAssetId:'host',type:'hosted_on',critical:true},
    {id:'r2',sourceAssetId:'noc',targetAssetId:'vm',type:'depends_on',critical:false},
    {id:'r3',sourceAssetId:'host',targetAssetId:'noc',type:'connected_to',critical:false},
  ];
  const impacted=calculateImpact('host',assets,relationships);
  assert.deepEqual(impacted.map(item=>item.asset.id),['vm','noc']);
  assert.deepEqual(impacted.map(item=>item.depth),[1,1]);
});

test('traduz relações direcionais em fluxo de impacto',()=>{
  const rows=[{id:'a',sourceAssetId:'app',targetAssetId:'db',type:'depends_on'},{id:'b',sourceAssetId:'core',targetAssetId:'access',type:'provides_service_to'}];
  assert.deepEqual(relationshipImpactEdges(rows).map(([from,to])=>[from,to]),[['db','app'],['core','access']]);
});
