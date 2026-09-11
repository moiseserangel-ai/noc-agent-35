import test from 'node:test';
import assert from 'node:assert/strict';
import { capacityForecast } from '../src/services/capacity.service.js';

const day=86400000;
test('prevê dias até saturação quando a utilização cresce',()=>{
  const start=Date.now()-4*day;
  const result=capacityForecast([60,65,70,75,80].map((value,index)=>({at:new Date(start+index*day),value})),85);
  assert.equal(result.trend,'rising');
  assert.equal(result.slopePerDay,5);
  assert.equal(result.daysToThreshold,1);
});

test('classifica tendência estável e histórico insuficiente',()=>{
  const start=Date.now()-3*day;
  const stable=capacityForecast([50,50.1,49.9,50].map((value,index)=>({at:new Date(start+index*day),value})));
  assert.equal(stable.trend,'stable');
  assert.equal(stable.daysToThreshold,null);
  assert.equal(capacityForecast([{at:new Date(),value:10}]).trend,'insufficient');
});
