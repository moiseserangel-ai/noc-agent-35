import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateChangeRisk, validateChangeWindow } from '../src/services/change-request.service.js';

test('calcula risco maior para mudança emergencial em equipamentos de core',()=>{
  const low=calculateChangeRisk({changeType:'standard',impact:'Ajuste isolado sem efeito aos usuários',executionPlan:'Alteração local controlada',rollbackPlan:'Restaurar a configuração anterior validada',windowStart:new Date(),windowEnd:new Date(Date.now()+3600000)},1);
  const high=calculateChangeRisk({changeType:'emergency',impact:'Indisponibilidade do core e internet',executionPlan:'Alterar BGP e gateway',rollbackPlan:'curto'},4);
  assert.equal(low.level,'low');
  assert.ok(high.score>=70);
  assert.equal(high.level,'critical');
});

test('valida janela de manutenção e rejeita ordem inválida',()=>{
  const start=new Date(Date.now()+3600000);
  const end=new Date(start.getTime()+7200000);
  const window=validateChangeWindow(start,end);
  assert.equal(window.start.getTime(),start.getTime());
  assert.throws(()=>validateChangeWindow(end,start),/posterior/);
});

test('impacto crítico do CMDB aumenta o risco da mudança',()=>{
  const input={changeType:'standard',impact:'Ajuste controlado',executionPlan:'Alteração local planejada',rollbackPlan:'Restaurar toda a configuração anterior',windowStart:new Date(),windowEnd:new Date(Date.now()+3600000)};
  const base=calculateChangeRisk(input,1);
  const mapped=calculateChangeRisk(input,1,{impacted:4,critical:2});
  assert.ok(mapped.score>base.score);assert.ok(['high','critical'].includes(mapped.level));
});
