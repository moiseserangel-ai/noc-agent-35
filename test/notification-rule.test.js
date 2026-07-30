import test from 'node:test';
import assert from 'node:assert/strict';
import { ruleMatches, publicRule, validateNotificationRule } from '../src/services/notification-rule.service.js';

const base={enabled:true,priorities:'critical',events:'opened',sources:'dashboard,zabbix',deviceGroups:'core',activeDays:'1,2,3,4,5',startTime:'08:00',endTime:'18:00',timezone:'America/Porto_Velho',channels:'panel,telegram',recipients:'123'};
const task={priority:'critical',source:'dashboard:session-1',device:{group:'core'}};

test('notification rule matches normalized dashboard source and business window',()=>{
  assert.equal(ruleMatches(base,{task,event:'opened',now:new Date('2026-07-30T14:00:00Z')}),true);
});

test('notification rule rejects values outside its filters',()=>{
  assert.equal(ruleMatches(base,{task:{...task,priority:'low'},event:'opened',now:new Date('2026-07-30T14:00:00Z')}),false);
  assert.equal(ruleMatches(base,{task,event:'resolved',now:new Date('2026-07-30T14:00:00Z')}),false);
});

test('notification rule supports overnight windows',()=>{
  const overnight={...base,startTime:'22:00',endTime:'06:00',activeDays:'5'};
  assert.equal(ruleMatches(overnight,{task,event:'opened',now:new Date('2026-07-31T05:00:00Z')}),true);
});

test('notification rule validation and public representation normalize arrays',()=>{
  const data=validateNotificationRule({name:'Críticos',channels:['panel'],activeDays:[1,2],startTime:'00:00',endTime:'23:59',timezone:'America/Porto_Velho'},'admin');
  assert.deepEqual(publicRule({...data,id:'1'}).activeDays,[1,2]);
  assert.deepEqual(publicRule({...data,id:'1'}).channels,['panel']);
});
