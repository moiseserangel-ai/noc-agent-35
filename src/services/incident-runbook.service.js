import prisma from '../database/client.js';
import { publicRunbook } from './runbook.service.js';

const normalize=value=>String(value||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase();
const words=value=>new Set(normalize(value).split(/[^a-z0-9]+/).filter(word=>word.length>=4));
const signals=[
  {pattern:/interface|porta|link|ether|vlan/,terms:['interface','porta','link','vlan']},
  {pattern:/route|rota|routing|bgp|ospf/,terms:['route','rota','routing','bgp','ospf']},
  {pattern:/cpu|memoria|memory|disco|disk|service|servico/,terms:['cpu','memory','memoria','disk','disco','service','servico']},
  {pattern:/firewall|security|ataque|bloqueio/,terms:['firewall','security','seguranca']},
  {pattern:/latencia|latency|perda|packet|ping|indisponivel/,terms:['ping','alcance','conectividade','network']},
];

export async function recommendRunbooksForTask(task){
  if(!task.deviceId||!task.device)return[];
  const rows=await prisma.runbook.findMany({where:{status:'published',deviceType:{in:['any',task.device.type]}},include:{_count:{select:{executions:true}}},orderBy:{updatedAt:'desc'}});
  const incident=normalize(`${task.originalMessage} ${task.diagnosis||''}`);
  const incidentWords=words(incident);
  return rows.map(row=>({...publicRunbook(row),...scoreRunbookForIncident(row,incidentWords,incident,task.device.type)})).sort((a,b)=>b.recommendationScore-a.recommendationScore||new Date(b.updatedAt)-new Date(a.updatedAt)).slice(0,5);
}

export function scoreRunbookForIncident(row,incidentWordsOrText,normalizedIncident='',deviceType){
  const incidentWords=incidentWordsOrText instanceof Set?incidentWordsOrText:words(incidentWordsOrText);
  const incident=normalizedIncident||normalize(incidentWordsOrText);
  const document=normalize(`${row.name} ${row.description} ${row.category}`);
  const documentWords=words(document);
  let score=row.deviceType===deviceType?45:25;
  const reasons=[row.deviceType===deviceType?'Compatível com o fabricante':'Compatível com todos os tipos'];
  const overlap=[...incidentWords].filter(word=>documentWords.has(word));
  score+=Math.min(overlap.length*8,24);
  if(overlap.length)reasons.push(`Termos relacionados: ${overlap.slice(0,3).join(', ')}`);
  for(const signal of signals)if(signal.pattern.test(incident)&&signal.terms.some(term=>document.includes(term))){score+=18;reasons.push('Relacionado ao tipo do alerta');break;}
  if(row.riskLevel==='low'){score+=5;reasons.push('Somente consulta');}
  return{recommendationScore:Math.min(score,100),recommendationReasons:reasons};
}
