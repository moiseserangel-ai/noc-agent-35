import PDFDocument from 'pdfkit';
import prisma from '../database/client.js';

const severityLabel = { critical:'Crítica', high:'Alta', medium:'Média', low:'Baixa' };
const statusLabel = { compliant:'Conforme', non_compliant:'Não conforme', excepted:'Exceção aceita' };
const changeLabel = { unchanged:'Sem alteração', regressed:'Regressão', recovered:'Recuperado', new_non_compliant:'Novo desvio' };

function reportRange(query = {}) {
  const now = new Date();
  let from;
  let to;
  if (query.from && query.to) {
    from = new Date(`${query.from}T00:00:00`);
    to = new Date(`${query.to}T23:59:59.999`);
  } else {
    const days = Math.min(Math.max(Number(query.days) || 30, 1), 366);
    to = now;
    from = new Date(now.getTime() - days * 86400000);
  }
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) throw Object.assign(new Error('Período inválido'), { statusCode:400 });
  if (to.getTime() - from.getTime() > 366 * 86400000) throw Object.assign(new Error('O relatório está limitado a 366 dias'), { statusCode:400 });
  return { from, to };
}

export async function buildComplianceReport(query = {}) {
  const range = reportRange(query);
  const deviceId = query.deviceId ? String(query.deviceId) : undefined;
  const scans = await prisma.complianceScan.findMany({
    where:{status:'completed',startedAt:{gte:range.from,lte:range.to},...(deviceId&&{deviceId})},
    include:{device:{select:{id:true,name:true,hostname:true,type:true,group:true,model:true,osVersion:true}},findings:{orderBy:[{severity:'asc'},{category:'asc'}]}},
    orderBy:{startedAt:'desc'},
    take:2000,
  });
  const exceptions = await prisma.complianceException.findMany({
    where:{...(deviceId&&{deviceId}),startsAt:{lte:range.to},expiresAt:{gte:range.from}},
    include:{device:{select:{name:true,hostname:true}}},
    orderBy:{createdAt:'desc'},
  });
  const findings = scans.flatMap(scan=>scan.findings.map(item=>({...item,scanId:scan.id,scanDate:scan.startedAt,scanScore:scan.score,scanProfile:scan.profile,device:scan.device})));
  const scores = scans.filter(scan=>scan.score!==null).map(scan=>scan.score);
  return {
    generatedAt:new Date(),
    range,
    filters:{deviceId:deviceId||null},
    summary:{
      scans:scans.length,
      devices:new Set(scans.map(scan=>scan.deviceId)).size,
      averageScore:scores.length?Math.round(scores.reduce((sum,value)=>sum+value,0)/scores.length):0,
      nonCompliant:findings.filter(item=>item.status==='non_compliant').length,
      regressions:findings.filter(item=>item.change==='regressed').length,
      accepted:findings.filter(item=>item.status==='excepted').length,
      exceptions:exceptions.length,
    },
    scans,
    findings,
    exceptions,
  };
}

const safeCsv = value => {
  let text = String(value ?? '');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"','""')}"`;
};

export function complianceReportCsv(report) {
  const header = ['Data','Equipamento','Endereço','Grupo','Perfil','Pontuação','Controle','Categoria','Severidade','Status','Mudança','Evidência','Recomendação','ID da exceção'];
  const rows = report.findings.map(item=>[
    item.scanDate.toISOString(),item.device.name,item.device.hostname,item.device.group||'',item.scanProfile,item.scanScore,
    item.title,item.category,severityLabel[item.severity]||item.severity,statusLabel[item.status]||item.status,
    changeLabel[item.change]||item.change,item.evidence||'',item.recommendation||'',item.exceptionId||'',
  ]);
  return Buffer.from(`\ufeff${[header,...rows].map(row=>row.map(safeCsv).join(';')).join('\r\n')}`,'utf8');
}

const ptDate = value => new Date(value).toLocaleString('pt-BR',{timeZone:'America/Porto_Velho'});
const clean = value => String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'');

export async function complianceReportPdf(report, branding = {}) {
  const doc = new PDFDocument({size:'A4',margins:{top:46,bottom:52,left:44,right:44},bufferPages:true,info:{Title:'Relatório de Compliance',Author:branding.name||'NOC Agent'}});
  const chunks = [];
  doc.on('data',chunk=>chunks.push(chunk));
  const done = new Promise((resolve,reject)=>{doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
  const primary = /^#[0-9a-f]{6}$/i.test(branding.primaryColor||'') ? branding.primaryColor : '#00a8cc';
  const left=44;
  const width=507;
  const bottom=738;
  const ensureSpace = height => { if(doc.y+height>bottom){doc.addPage();doc.x=left;doc.y=46;} };
  const heading = title => {
    ensureSpace(38);
    const y=doc.y+8;
    doc.roundedRect(left,y,width,25,4).fill(primary);
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#ffffff').text(title,left+10,y+7,{width:width-20});
    doc.x=left;doc.y=y+34;
  };
  const smallLine = (label,value,x=left,available=width) => {
    doc.font('Helvetica-Bold').fontSize(7.4).fillColor('#374151').text(`${label}: `,x,doc.y,{continued:true,width:available});
    doc.font('Helvetica').fillColor('#4b5563').text(clean(value),{width:available});
  };

  doc.font('Helvetica-Bold').fontSize(22).fillColor(primary).text(clean(branding.name||'NOC Agent'),left,46,{width});
  doc.fontSize(15).fillColor('#1f2937').text('Relatório de Compliance de Configurações',left,76,{width});
  doc.font('Helvetica').fontSize(8).fillColor('#6b7280').text(`Gerado em ${ptDate(report.generatedAt)}`,left,101,{width});
  doc.text(`Período analisado: ${ptDate(report.range.from)} até ${ptDate(report.range.to)}`,left,114,{width});
  doc.moveTo(left,132).lineTo(left+width,132).lineWidth(1.5).strokeColor(primary).stroke();

  const metrics=[['Verificações',report.summary.scans],['Equipamentos',report.summary.devices],['Pontuação média',`${report.summary.averageScore}%`],['Desvios',report.summary.nonCompliant],['Regressões',report.summary.regressions],['Exceções',report.summary.exceptions]];
  const cardWidth=(width-10)/3;
  metrics.forEach(([label,value],index)=>{
    const row=Math.floor(index/3),column=index%3,x=left+column*(cardWidth+5),y=148+row*55;
    doc.roundedRect(x,y,cardWidth,48,4).fillAndStroke('#f4f7f9','#dce4e8');
    doc.font('Helvetica-Bold').fontSize(15).fillColor('#1f2937').text(String(value),x+8,y+8,{width:cardWidth-16,align:'center'});
    doc.font('Helvetica').fontSize(7).fillColor('#6b7280').text(label,x+8,y+29,{width:cardWidth-16,align:'center'});
  });
  doc.x=left;doc.y=267;

  heading('1. Resumo das verificações');
  if(!report.scans.length)doc.font('Helvetica').fontSize(9).fillColor('#6b7280').text('Nenhuma verificação concluída no período.',left,doc.y,{width});
  for(const [index,scan] of report.scans.entries()){
    ensureSpace(54);
    const y=doc.y;
    doc.roundedRect(left,y,width,47,3).fill(index%2?'#ffffff':'#f8fafb');
    doc.rect(left,y,4,47).fill(scan.score>=80?'#168653':scan.score>=60?'#b26a00':'#c62828');
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#1f2937').text(clean(scan.device.name),left+12,y+8,{width:180});
    doc.font('Helvetica').fontSize(7).fillColor('#6b7280').text(`${clean(scan.device.hostname)} · ${ptDate(scan.startedAt)}`,left+12,y+23,{width:210});
    doc.font('Helvetica-Bold').fontSize(14).fillColor(scan.score>=80?'#168653':scan.score>=60?'#b26a00':'#c62828').text(`${scan.score}%`,left+225,y+8,{width:55,align:'center'});
    doc.font('Helvetica').fontSize(6.8).fillColor('#6b7280').text(clean(scan.profile),left+215,y+27,{width:75,align:'center'});
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#374151').text(`${scan.passed} atendidos`,left+305,y+9,{width:85});
    doc.fillColor(scan.failed?'#c62828':'#168653').text(`${scan.failed} desvios`,left+305,y+24,{width:85});
    doc.font('Helvetica').fontSize(7).fillColor('#6b7280').text(`${scan.regressions} regressões\n${scan.recoveries} recuperações`,left+405,y+9,{width:90});
    doc.x=left;doc.y=y+52;
  }

  ensureSpace(110);
  heading('2. Controles e evidências');
  if(!report.findings.length)doc.font('Helvetica').fontSize(9).fillColor('#6b7280').text('Nenhum controle avaliado no período.',left,doc.y,{width});
  for(const item of report.findings){
    const evidence=clean(item.evidence||'Não informada');
    const recommendation=item.status==='non_compliant'?clean(item.recommendation||'Não informada'):'';
    doc.font('Helvetica').fontSize(7.2);
    const evidenceHeight=doc.heightOfString(evidence,{width:width-24});
    const recommendationHeight=recommendation?doc.heightOfString(recommendation,{width:width-24}):0;
    const cardHeight=Math.max(65,50+evidenceHeight+recommendationHeight);
    ensureSpace(Math.min(cardHeight,690)+8);
    const y=doc.y;
    const color=item.status==='non_compliant'?'#c62828':item.status==='excepted'?'#b26a00':'#168653';
    doc.roundedRect(left,y,width,cardHeight,4).fillAndStroke('#ffffff','#dfe5e8');
    doc.rect(left,y,4,cardHeight).fill(color);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(color).text(`${statusLabel[item.status]||item.status} · ${severityLabel[item.severity]||item.severity}`,left+12,y+8,{width:135});
    doc.fillColor('#1f2937').text(clean(item.title),left+150,y+8,{width:width-162});
    doc.font('Helvetica').fontSize(7).fillColor('#6b7280').text(`${clean(item.device.name)} · ${ptDate(item.scanDate)} · ${changeLabel[item.change]||item.change}`,left+12,y+23,{width:width-24});
    doc.y=y+38;smallLine('Evidência',evidence,left+12,width-24);
    if(recommendation){doc.y+=3;smallLine('Recomendação',recommendation,left+12,width-24);}
    doc.x=left;doc.y=y+cardHeight+7;
  }

  ensureSpace(110);
  heading('3. Exceções registradas');
  if(!report.exceptions.length)doc.font('Helvetica').fontSize(9).fillColor('#6b7280').text('Nenhuma exceção registrada no período.',left,doc.y,{width});
  for(const item of report.exceptions){
    doc.font('Helvetica').fontSize(7.2);
    const reason=clean(item.reason);
    const height=Math.max(78,62+doc.heightOfString(reason,{width:width-24}));
    ensureSpace(height+8);
    const y=doc.y;
    doc.roundedRect(left,y,width,height,4).fillAndStroke('#fffaf0','#ead8af');
    doc.rect(left,y,4,height).fill('#b26a00');
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#1f2937').text(`${clean(item.device.name)} · ${clean(item.ruleKey)}`,left+12,y+8,{width:width-24});
    doc.y=y+25;smallLine('Justificativa',reason,left+12,width-24);
    doc.y+=3;smallLine('Responsável',item.approvedBy,left+12,width-24);
    doc.y+=3;smallLine('Validade',`${ptDate(item.startsAt)} até ${ptDate(item.expiresAt)}${item.revokedAt?` · Revogada por ${item.revokedBy} em ${ptDate(item.revokedAt)}`:''}`,left+12,width-24);
    doc.x=left;doc.y=y+height+7;
  }

  const range=doc.bufferedPageRange();
  for(let index=range.start;index<range.start+range.count;index++){
    doc.switchToPage(index);
    const pageNumber=index-range.start+1;
    doc.moveTo(left,758).lineTo(left+width,758).lineWidth(.5).strokeColor('#d1d5db').stroke();
    doc.font('Helvetica').fontSize(7).fillColor('#6b7280').text(clean(branding.name||'NOC Agent'),left,765,{width:250,lineBreak:false});
    doc.text(`Relatório de Compliance · Página ${pageNumber} de ${range.count}`,left+257,765,{width:250,align:'right',lineBreak:false});
  }
  doc.end();
  return done;
}
