import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CMDB_CATEGORIES, CMDB_CRITICALITIES, CMDB_STATUSES, normalizeCmdbAsset } from '../src/services/cmdb.service.js';
import { nextInventoryAt, parseInventoryOutput } from '../src/services/cmdb-inventory.service.js';
import { calculateImpact, CMDB_RELATIONSHIP_TYPES, relationshipImpactEdges } from '../src/services/cmdb-relationship.service.js';
import { assessCmdbAsset } from '../src/services/cmdb-governance.service.js';
import { buildOperationalContext } from '../src/services/cmdb-operational-context.service.js';
import { topologySuggestionCandidate } from '../src/services/cmdb-discovery.service.js';
import { diffCmdbValues } from '../src/services/cmdb-history.service.js';

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

test('governança sinaliza cadastro incompleto e inventário vencido',()=>{
  const now=new Date('2026-08-01T12:00:00Z');
  const result=assessCmdbAsset({status:'active',criticality:'critical',deviceId:'device-1',lastInventoryAt:new Date('2026-06-01T12:00:00Z'),lastInventoryStatus:'success',serialNumber:null,managementIp:'10.0.0.1',hostname:null,manufacturer:'MikroTik',model:'CCR',owner:null,location:'POP',siteId:null,warrantyUntil:new Date('2026-07-01T12:00:00Z'),supportUntil:null,_count:{relationshipsFrom:0,relationshipsTo:0}},now);
  assert.ok(result.score<75);
  assert.ok(result.issues.some(row=>row.code==='inventory_stale'));
  assert.ok(result.issues.some(row=>row.code==='warrantyUntil_expired'));
  assert.ok(result.issues.some(row=>row.code==='critical_unmapped'));
});

test('governança reconhece ativo completo e atualizado',()=>{
  const now=new Date('2026-08-01T12:00:00Z');
  const result=assessCmdbAsset({status:'active',criticality:'high',deviceId:'device-1',lastInventoryAt:new Date('2026-07-30T12:00:00Z'),lastInventoryStatus:'success',serialNumber:'ABC',managementIp:'10.0.0.1',manufacturer:'Cisco',model:'C8300',owner:'NOC',location:'POP',_count:{relationshipsFrom:1,relationshipsTo:0}},now);
  assert.equal(result.score,100);assert.equal(result.grade,'excellent');assert.equal(result.issues.length,0);
});

test('contexto operacional relaciona equipamento e elimina impactos duplicados',()=>{
  const assets=[{id:'core',deviceId:'d1',name:'Core',criticality:'critical'},{id:'app',deviceId:null,name:'Aplicação',criticality:'high'},{id:'client',deviceId:null,name:'Cliente',criticality:'medium'}];
  const relationships=[{id:'r1',sourceAssetId:'app',targetAssetId:'core',type:'depends_on',critical:true},{id:'r2',sourceAssetId:'client',targetAssetId:'app',type:'depends_on',critical:false}];
  const context=buildOperationalContext(['d1'],assets,relationships);
  assert.equal(context.summary.mapped,1);assert.equal(context.summary.impacted,2);assert.equal(context.summary.critical,1);assert.equal(context.summary.maxDepth,2);
  assert.deepEqual(context.impacted.map(item=>item.asset.id),['app','client']);
});

test('descoberta converte conexão de topologia em sugestão CMDB',()=>{
  const link={id:'link1',sourceDeviceId:'d2',targetDeviceId:'d1',source:'lldp',linkType:'fiber',label:'SFP1 ↔ GE0/0/1',sourceDevice:{name:'A'},targetDevice:{name:'B'}},assets=[{id:'asset-a',deviceId:'d1',tenantId:'tenant'},{id:'asset-b',deviceId:'d2',tenantId:'tenant'}];
  const result=topologySuggestionCandidate(link,assets,[]);
  assert.equal(result.suggestedType,'connected_to');assert.equal(result.confidence,90);assert.equal(result.sourceAssetId,'asset-a');assert.match(result.evidence,/SFP1/);
  assert.equal(topologySuggestionCandidate(link,assets,[{sourceAssetId:'asset-b',targetAssetId:'asset-a',type:'connected_to'}]),null);
});

test('descoberta não sugere relação entre clientes diferentes',()=>{
  const link={id:'link1',sourceDeviceId:'d1',targetDeviceId:'d2'},assets=[{id:'a',deviceId:'d1',tenantId:'one'},{id:'b',deviceId:'d2',tenantId:'two'}];
  assert.equal(topologySuggestionCandidate(link,assets,[]),null);
});

test('histórico registra somente diferenças reais e normaliza datas',()=>{
  const before={name:'Roteador',serialNumber:'ABC',warrantyUntil:new Date('2027-01-01T00:00:00Z')},after={name:'Roteador',serialNumber:'XYZ',warrantyUntil:new Date('2027-01-01T00:00:00Z')};
  assert.deepEqual(diffCmdbValues(before,after,['name','serialNumber','warrantyUntil']),[{field:'serialNumber',before:'ABC',after:'XYZ'}]);
});

test('schema mantém histórico vinculado ao ciclo de vida do ativo',()=>{
  const schema=fs.readFileSync(new URL('../prisma/schema.prisma',import.meta.url),'utf8');
  assert.match(schema,/model CmdbHistory/);assert.match(schema,/asset\s+CmdbAsset.+onDelete: Cascade/);
});
