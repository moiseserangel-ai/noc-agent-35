import test from'node:test';
import assert from'node:assert/strict';
import{availabilityFromEvents,deriveServiceStatus}from'../src/services/status-page.service.js';

const service={enabled:true,automatic:true,manualStatus:'operational'};
test('estado automático reflete a maior prioridade de Task aberta',()=>{
 assert.equal(deriveServiceStatus(service,{tasks:[{priority:'medium',status:'pending'}]}),'degraded');
 assert.equal(deriveServiceStatus(service,{tasks:[{priority:'high',status:'pending'}]}),'partial_outage');
 assert.equal(deriveServiceStatus(service,{tasks:[{priority:'critical',status:'pending'}]}),'major_outage');
 assert.equal(deriveServiceStatus(service,{tasks:[{priority:'critical',status:'resolved'}]}),'operational');
});
test('manutenção ativa tem precedência sobre automação',()=>{
 const now=new Date('2026-07-30T15:00:00Z'),incidents=[{status:'scheduled',scheduledAt:new Date('2026-07-30T14:00:00Z'),scheduledEndAt:new Date('2026-07-30T16:00:00Z'),severity:'maintenance'}];
 assert.equal(deriveServiceStatus(service,{tasks:[],incidents,now}),'maintenance');
});
test('modo manual preserva o estado editorial',()=>{
 assert.equal(deriveServiceStatus({...service,automatic:false,manualStatus:'degraded'},{tasks:[{priority:'critical',status:'pending'}]}),'degraded');
});
test('disponibilidade desconta períodos de indisponibilidade',()=>{
 const now=new Date('2026-07-30T15:00:00Z'),events=[{status:'major_outage',startedAt:new Date(now-3600_000)},{status:'operational',startedAt:new Date(now-1800_000)}];
 const result=availabilityFromEvents(events,now,1);
 assert.ok(result>97.9&&result<98);
});
