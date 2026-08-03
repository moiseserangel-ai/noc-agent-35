import PDFDocument from 'pdfkit';
import prisma from '../database/client.js';
import {lifecycleDashboard} from './lifecycle.service.js';
import {catalogVerificationStatus} from './lifecycle-catalog.service.js';

const DAY=86400000;
const clean=value=>String(value??'').replace(/[\r\n]+/g,' ').trim();
const safe=value=>{const result=clean(value);return /^[=+\-@]/.test(result)?`'${result}`:result;};
const csv=value=>`"${safe(value).replaceAll('"','""')}"`;
const iso=value=>value?new Date(value).toISOString():'';
const labels={healthy:'Saudável',attention:'Até 90 dias',warning:'Até 30 dias',critical:'Até 7 dias',expired:'Vencido',unknown:'Cadastro incompleto'};

export async function lifecycleReport({tenantId,manufacturer,status,days=90}={}){
  const period=Math.min(Math.max(Number(days)||90,7),365),from=new Date(Date.now()-period*DAY),dashboard=await lifecycleDashboard({tenantId,manufacturer,status}),assetIds=dashboard.rows.map(row=>row.id),incidentKeys=assetIds.map(id=>`lifecycle:${id}`);
  const [alerts,tasks]=await Promise.all([
    assetIds.length?prisma.cmdbLifecycleAlert.findMany({where:{assetId:{in:assetIds},OR:[{openedAt:{gte:from}},{lastSeenAt:{gte:from}},{resolvedAt:{gte:from}}]},select:{assetId:true,type:true,severity:true,status:true,title:true,openedAt:true,lastSeenAt:true,resolvedAt:true},orderBy:{lastSeenAt:'desc'}}):[],
    incidentKeys.length?prisma.task.findMany({where:{incidentKey:{in:incidentKeys}},select:{taskNumber:true,status:true,priority:true,incidentKey:true,createdAt:true,resolvedAt:true},orderBy:{createdAt:'desc'}}):[],
  ]),alertsByAsset=new Map(),tasksByAsset=new Map();
  alerts.forEach(item=>{const list=alertsByAsset.get(item.assetId)||[];list.push(item);alertsByAsset.set(item.assetId,list);});tasks.forEach(item=>{const id=item.incidentKey?.slice('lifecycle:'.length),list=tasksByAsset.get(id)||[];list.push(item);tasksByAsset.set(id,list);});
  const rows=dashboard.rows.map(row=>({...row,reportAlerts:alertsByAsset.get(row.id)||[],reportTasks:tasksByAsset.get(row.id)||[]})),discontinued=rows.filter(row=>row.lifecycle.catalogMatch?.productStatus==='discontinued').length,unmatched=rows.filter(row=>!row.lifecycle.catalogMatch).length,staleSources=rows.filter(row=>row.lifecycle.catalogMatch&&catalogVerificationStatus(row.lifecycle.catalogMatch).status!=='current').length;
  return{...dashboard,rows,filters:{tenantId:tenantId||null,manufacturer:manufacturer||null,status:status||null,days:period,from:from.toISOString()},summary:{...dashboard.summary,discontinued,unmatched,staleSources,alerts:alerts.length,tasks:tasks.length}};
}

export function lifecycleCsv(report){const rows=[['Patrimônio','Ativo','Cliente','Fabricante','Modelo','Versão','Criticidade','Situação','Risco','Estado oficial','Produto do catálogo','Garantia','Fim de suporte','Licença','Fonte oficial','Última verificação','Alertas no período','Tasks','Recomendação']];report.rows.forEach(row=>{const catalog=row.lifecycle.catalogMatch;rows.push([row.assetTag,row.name,row.tenant?.name||'Global',row.manufacturer||row.device?.manufacturer||'',row.model||row.device?.model||'',row.device?.osVersion||'',row.criticality,labels[row.lifecycle.status]||row.lifecycle.status,row.lifecycle.riskScore,catalog?.productStatus||'não classificado',catalog?.product||'',iso(row.warrantyUntil),iso(row.supportUntil||catalog?.endOfSupportDate),iso(row.licenseUntil),catalog?.sourceUrl||'',iso(catalog?.lastVerifiedAt),row.reportAlerts.map(item=>`${item.type}:${item.status}`).join(', '),row.reportTasks.map(item=>`#${item.taskNumber}:${item.status}`).join(', '),row.lifecycle.recommendation]);});return Buffer.from(`\ufeff${rows.map(row=>row.map(csv).join(';')).join('\r\n')}`,'utf8');}

export async function lifecyclePdf(report,title='NOC Agent'){
  const doc=new PDFDocument({size:'A4',margin:42,bufferPages:true,info:{Title:'Relatório Executivo de Ciclo de Vida',Author:title}}),chunks=[];doc.on('data',chunk=>chunks.push(chunk));
  doc.fontSize(18).fillColor('#123047').text('Relatório Executivo de Ciclo de Vida');doc.fontSize(9).fillColor('#526577').text(`${title} · período operacional de ${report.filters.days} dias · gerado em ${new Date().toLocaleString('pt-BR')}`);doc.moveDown();
  const s=report.summary;doc.fontSize(11).fillColor('#123047').text(`Ativos: ${s.assets}   Risco alto: ${s.highRisk}   Descontinuados: ${s.discontinued}   Vencidos: ${s.expired}`);doc.text(`Até 30 dias: ${(s.critical||0)+(s.warning||0)}   Sem catálogo: ${s.unmatched}   Alertas: ${s.alerts}   Tasks: ${s.tasks}`);doc.moveDown();
  doc.fontSize(13).text('Distribuição por fabricante');report.byManufacturer.forEach(item=>doc.fontSize(9).text(`${item.name}: ${item.count}`));doc.moveDown();doc.fontSize(13).text('Ativos e recomendações');
  report.rows.sort((a,b)=>b.lifecycle.riskScore-a.lifecycle.riskScore).forEach(row=>{if(doc.y>710)doc.addPage();const catalog=row.lifecycle.catalogMatch;doc.fontSize(9).fillColor('#123047').text(`${row.assetTag} · ${row.name} · risco ${row.lifecycle.riskScore}/100 · ${labels[row.lifecycle.status]||row.lifecycle.status}`);doc.fontSize(8).fillColor('#526577').text(`${row.tenant?.name||'Global'} · ${row.manufacturer||'Não informado'} ${row.model||''} · versão ${row.device?.osVersion||'não coletada'}`);doc.text(`Catálogo: ${catalog?`${catalog.product} (${catalog.productStatus})`:'sem correspondência'} · Alertas: ${row.reportAlerts.length} · Tasks: ${row.reportTasks.length}`);doc.text(`Recomendação: ${clean(row.lifecycle.recommendation)}`);if(catalog?.sourceUrl)doc.fillColor('#2563a8').text(`Fonte: ${catalog.sourceUrl}`,{link:catalog.sourceUrl,underline:true});doc.moveDown(.45);});
  doc.end();await new Promise((resolve,reject)=>{doc.on('end',resolve);doc.on('error',reject);});return Buffer.concat(chunks);
}
