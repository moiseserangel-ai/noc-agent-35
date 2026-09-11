import test from 'node:test';
import assert from 'node:assert/strict';
import { nextScheduleRun, validateTimezone } from '../src/services/runbook-schedule.service.js';

test('calcula execução diária respeitando America/Porto_Velho',()=>{
  const from=new Date('2026-07-30T04:00:00.000Z');
  const next=nextScheduleRun({frequency:'daily',hour:2,minute:30,dayOfWeek:null,timezone:'America/Porto_Velho'},from);
  assert.equal(next.toISOString(),'2026-07-30T06:30:00.000Z');
});

test('calcula próxima execução semanal pelo dia local',()=>{
  const from=new Date('2026-07-30T12:00:00.000Z');
  const next=nextScheduleRun({frequency:'weekly',hour:2,minute:0,dayOfWeek:1,timezone:'America/Porto_Velho'},from);
  assert.equal(next.toISOString(),'2026-08-03T06:00:00.000Z');
});

test('rejeita fuso horário e agenda semanal inválidos',()=>{
  assert.throws(()=>validateTimezone('Fuso/Inexistente'),/Fuso horário/);
  assert.throws(()=>nextScheduleRun({frequency:'weekly',hour:2,minute:0,dayOfWeek:9,timezone:'UTC'}),/Dia da semana/);
});
