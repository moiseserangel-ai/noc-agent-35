import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBusinessService } from '../src/services/business-service.service.js';

test('normaliza catálogo de serviço e SLA',async()=>{const row=await normalizeBusinessService({name:'Internet Corporativa',code:'internet corp',criticality:'critical',slaMinutes:240});assert.equal(row.code,'INTERNET-CORP');assert.equal(row.criticality,'critical');assert.equal(row.slaMinutes,240);});
test('rejeita SLA e cadastro incompleto',async()=>{await assert.rejects(()=>normalizeBusinessService({name:'x',code:'x'}),/nome/);await assert.rejects(()=>normalizeBusinessService({name:'Serviço válido',code:'svc',slaMinutes:0}),/SLA/);});
