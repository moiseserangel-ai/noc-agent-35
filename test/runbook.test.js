import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assessRunbookRisk, renderRunbook, runbookInputHash, validateRunbookDefinition } from '../src/services/runbook.service.js';
import { listRunbookTemplates } from '../src/services/runbook-template.service.js';

const device={id:'dev-1',type:'cisco_ios'};
const base={
  name:'Diagnóstico de interface',
  description:'Consulta e valida o estado operacional de uma interface.',
  category:'diagnostic',
  deviceType:'cisco_ios',
  variables:[{key:'interface',label:'Interface',required:true,pattern:'^[A-Za-z0-9/.-]+$'}],
  steps:[{name:'Consultar interface',deviceType:'any',command:'show interface {{interface}}',validation:'show interface {{interface}} status',rollback:''}],
};

test('normaliza e renderiza um runbook compatível',()=>{
  const definition=validateRunbookDefinition(base);
  const rendered=renderRunbook(definition,{interface:'GigabitEthernet0/1'},device);
  assert.equal(rendered.steps[0].command,'show interface GigabitEthernet0/1');
  assert.equal(rendered.steps[0].commandType,'read');
  assert.equal(rendered.hasChanges,false);
});

test('rejeita variável fora do padrão antes da execução',()=>{
  const definition=validateRunbookDefinition(base);
  assert.throws(()=>renderRunbook(definition,{interface:'Gi0/1; reload'},device),/Valor inválido/);
});

test('hash da simulação é determinístico e sensível à entrada',()=>{
  assert.equal(runbookInputHash('r1','d1',{b:'2',a:'1'}),runbookInputHash('r1','d1',{a:'1',b:'2'}));
  assert.notEqual(runbookInputHash('r1','d1',{a:'1'}),runbookInputHash('r1','d1',{a:'2'}));
});

test('não aceita variável secreta para evitar exposição em comandos renderizados',()=>{
  assert.throws(()=>validateRunbookDefinition({...base,variables:[{key:'token_api',label:'Token',secret:true}]}),/Variáveis secretas/);
});

test('todos os modelos da biblioteca são válidos e somente de consulta',()=>{
  const templates=listRunbookTemplates();
  assert.ok(templates.length>=10);
  for(const template of templates){
    const definition=validateRunbookDefinition(template);
    const values=Object.fromEntries(definition.variables.map(item=>[item.key,item.default]));
    const rendered=renderRunbook(definition,values,{id:'device',type:template.deviceType});
    assert.equal(rendered.hasChanges,false,template.name);
    assert.ok(rendered.steps.length>0,template.name);
  }
});

test('classifica risco conforme alteração e disponibilidade de rollback',()=>{
  const read=validateRunbookDefinition(base);
  assert.equal(assessRunbookRisk(read),'low');
  const high=validateRunbookDefinition({...base,steps:[{name:'Desabilitar porta',command:'configure terminal\ninterface {{interface}}\nshutdown',rollback:'configure terminal\ninterface {{interface}}\nno shutdown'}]});
  assert.equal(assessRunbookRisk(high),'high');
  const critical=validateRunbookDefinition({...base,steps:[{name:'Desabilitar porta',command:'configure terminal\ninterface {{interface}}\nshutdown'}]});
  assert.equal(assessRunbookRisk(critical),'critical');
});

test('execuções mantêm snapshots anterior e posterior para comparação',()=>{
  const schema=fs.readFileSync(new URL('../prisma/schema.prisma',import.meta.url),'utf8');
  assert.match(schema,/beforeBackup\s+DeviceConfigBackup\?/);
  assert.match(schema,/afterBackup\s+DeviceConfigBackup\?/);
  assert.match(schema,/configurationChanged\s+Boolean\?/);
});
