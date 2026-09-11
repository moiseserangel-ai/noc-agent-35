import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreRunbookForIncident } from '../src/services/incident-runbook.service.js';

test('prioriza runbook compatível e relacionado ao alerta de interface',()=>{
  const interfaceBook={name:'Diagnóstico de interface',description:'Consulta link, porta e erros',category:'diagnostic',deviceType:'mikrotik',riskLevel:'low'};
  const routingBook={name:'Tabela de roteamento',description:'Consulta rotas BGP',category:'network',deviceType:'mikrotik',riskLevel:'low'};
  const incident='MikroTik: Interface vlan400 link down';
  const interfaceScore=scoreRunbookForIncident(interfaceBook,incident,'','mikrotik');
  const routingScore=scoreRunbookForIncident(routingBook,incident,'','mikrotik');
  assert.ok(interfaceScore.recommendationScore>routingScore.recommendationScore);
  assert.ok(interfaceScore.recommendationReasons.includes('Relacionado ao tipo do alerta'));
});

test('a compatibilidade exata do fabricante tem prioridade',()=>{
  const exact=scoreRunbookForIncident({name:'Saúde',description:'Diagnóstico geral',category:'diagnostic',deviceType:'cisco_ios',riskLevel:'low'},'equipamento indisponível','','cisco_ios');
  const generic=scoreRunbookForIncident({name:'Saúde',description:'Diagnóstico geral',category:'diagnostic',deviceType:'any',riskLevel:'low'},'equipamento indisponível','','cisco_ios');
  assert.ok(exact.recommendationScore>generic.recommendationScore);
});
