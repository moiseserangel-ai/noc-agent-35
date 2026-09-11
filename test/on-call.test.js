import test from 'node:test';
import assert from 'node:assert/strict';
import {localScheduleParts,shiftIsActive,validTime,validateTimezone} from '../src/services/on-call.service.js';

test('calcula dia e horário no fuso da equipe',()=>{
  assert.deepEqual(localScheduleParts(new Date('2026-07-30T14:30:00Z'),'America/Porto_Velho'),{day:4,minute:630});
});

test('identifica turno regular ativo e encerra no limite final',()=>{
  const shift={enabled:true,dayOfWeek:4,startTime:'08:00',endTime:'18:00'};
  assert.equal(shiftIsActive(shift,new Date('2026-07-30T14:30:00Z'),'America/Porto_Velho'),true);
  assert.equal(shiftIsActive(shift,new Date('2026-07-30T22:00:00Z'),'America/Porto_Velho'),false);
});

test('turno noturno permanece ativo depois da meia-noite',()=>{
  const shift={enabled:true,dayOfWeek:4,startTime:'22:00',endTime:'06:00'};
  assert.equal(shiftIsActive(shift,new Date('2026-07-31T03:00:00Z'),'America/Porto_Velho'),true);
  assert.equal(shiftIsActive(shift,new Date('2026-07-31T08:00:00Z'),'America/Porto_Velho'),true);
  assert.equal(shiftIsActive(shift,new Date('2026-07-31T10:00:00Z'),'America/Porto_Velho'),false);
});

test('valida horários e fusos usados pela escala',()=>{
  assert.equal(validTime('23:59'),true);assert.equal(validTime('25:00'),false);
  assert.equal(validateTimezone('America/Porto_Velho'),'America/Porto_Velho');
  assert.throws(()=>validateTimezone('Fuso/Inexistente'),/Fuso horário inválido/);
});
