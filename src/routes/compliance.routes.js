import { Router } from 'express';
import prisma from '../database/client.js';
import { COMPLIANCE_PROFILE, ensureComplianceProfiles, getComplianceProfiles, remediationNeedsPlanning, runComplianceScan, saveCompliancePolicy } from '../services/compliance.service.js';
import { logAudit, requestIdentity } from '../services/audit.service.js';
import { buildComplianceReport, complianceReportCsv, complianceReportPdf } from '../services/compliance-report.service.js';
import { getBranding } from '../services/branding.service.js';
import { addTaskMessage, createTask, updateTask } from '../services/task.service.js';
import { notifyTask } from '../services/notification.service.js';
import { verifyAuditChain } from '../services/audit.service.js';
import crypto from 'node:crypto';

const router = Router();

router.get('/governance', async(_req,res,next)=>{
  try{
    const [scopes,settings,packages,integrity]=await Promise.all([
      prisma.complianceScopePolicy.findMany({include:{profile:{select:{name:true,deviceType:true}},_count:{select:{devices:true}}},orderBy:[{priority:'asc'},{name:'asc'}]}),
      prisma.settings.findMany({where:{key:{startsWith:'compliance_escalation_'}}}),
      prisma.complianceAuditPackage.findMany({orderBy:{createdAt:'desc'},take:20}),
      verifyAuditChain(),
    ]);
    res.json({success:true,data:{scopes,escalation:Object.fromEntries(settings.map(item=>[item.key,item.value])),packages,integrity}});
  }catch(error){next(error);}
});

router.put('/governance/escalation',async(req,res,next)=>{
  try{
    const levels=[1,2,3];
    const values=levels.map(level=>Math.min(Math.max(Number(req.body[`level${level}Hours`])||[4,12,24][level-1],1),720));
    if(!(values[0]<values[1]&&values[1]<values[2]))return res.status(400).json({success:false,error:'Os tempos devem ser crescentes entre os níveis 1, 2 e 3'});
    await prisma.$transaction(levels.map((level,index)=>prisma.settings.upsert({where:{key:`compliance_escalation_level${level}_hours`},update:{value:String(values[index])},create:{key:`compliance_escalation_level${level}_hours`,value:String(values[index])}})));
    await logAudit({...requestIdentity(req),action:'update_escalation',resource:'compliance_governance',status:'success',details:{hours:values}});
    res.json({success:true,data:{level1Hours:values[0],level2Hours:values[1],level3Hours:values[2]}});
  }catch(error){next(error);}
});

router.post('/scopes',async(req,res,next)=>{
  try{
    const name=String(req.body.name||'').trim().slice(0,100);
    const profile=await prisma.complianceProfile.findUnique({where:{id:String(req.body.profileId||'')}});
    if(name.length<3||!profile)return res.status(400).json({success:false,error:'Informe nome e perfil válidos'});
    const scope=await prisma.complianceScopePolicy.create({data:{name,description:String(req.body.description||'').trim().slice(0,500)||null,deviceGroup:String(req.body.deviceGroup||'').trim().slice(0,100)||null,deviceRole:String(req.body.deviceRole||'').trim().slice(0,100)||null,profileId:profile.id,minimumScore:Math.min(Math.max(Number(req.body.minimumScore)||profile.minimumScore,1),100),priority:Math.min(Math.max(Number(req.body.priority)||100,1),999),createdBy:req.user.username},include:{profile:true,_count:{select:{devices:true}}}});
    await logAudit({...requestIdentity(req),action:'create_scope',resource:'compliance_governance',resourceId:scope.id,status:'success',details:{name,deviceGroup:scope.deviceGroup,deviceRole:scope.deviceRole,profile:profile.name}});
    res.status(201).json({success:true,data:scope});
  }catch(error){next(error);}
});

router.put('/scopes/:id',async(req,res,next)=>{
  try{
    const current=await prisma.complianceScopePolicy.findUnique({where:{id:req.params.id}});
    if(!current)return res.status(404).json({success:false,error:'Política organizacional não encontrada'});
    const scope=await prisma.complianceScopePolicy.update({where:{id:current.id},data:{name:String(req.body.name??current.name).trim().slice(0,100),description:String(req.body.description??current.description??'').trim().slice(0,500)||null,deviceGroup:String(req.body.deviceGroup??current.deviceGroup??'').trim().slice(0,100)||null,deviceRole:String(req.body.deviceRole??current.deviceRole??'').trim().slice(0,100)||null,profileId:req.body.profileId||current.profileId,minimumScore:Math.min(Math.max(Number(req.body.minimumScore)||current.minimumScore,1),100),priority:Math.min(Math.max(Number(req.body.priority)||current.priority,1),999),isActive:req.body.isActive===undefined?current.isActive:Boolean(req.body.isActive)},include:{profile:true,_count:{select:{devices:true}}}});
    await logAudit({...requestIdentity(req),action:'update_scope',resource:'compliance_governance',resourceId:scope.id,status:'success',details:{name:scope.name,isActive:scope.isActive}});
    res.json({success:true,data:scope});
  }catch(error){next(error);}
});

router.delete('/scopes/:id',async(req,res,next)=>{
  try{
    await prisma.device.updateMany({where:{complianceScopeId:req.params.id},data:{complianceScopeId:null}});
    await prisma.complianceScopePolicy.delete({where:{id:req.params.id}});
    await logAudit({...requestIdentity(req),action:'delete_scope',resource:'compliance_governance',resourceId:req.params.id,status:'success'});
    res.json({success:true,message:'Política organizacional excluída'});
  }catch(error){next(error);}
});

router.put('/scopes/:id/devices',async(req,res,next)=>{
  try{
    const ids=Array.isArray(req.body.deviceIds)?req.body.deviceIds.map(String):[];
    await prisma.$transaction([
      prisma.device.updateMany({where:{complianceScopeId:req.params.id},data:{complianceScopeId:null}}),
      ...(ids.length?[prisma.device.updateMany({where:{id:{in:ids}},data:{complianceScopeId:req.params.id}})]:[]),
    ]);
    await logAudit({...requestIdentity(req),action:'assign_scope',resource:'compliance_governance',resourceId:req.params.id,status:'success',details:{deviceIds:ids}});
    res.json({success:true,message:'Escopo aplicado aos equipamentos'});
  }catch(error){next(error);}
});

router.get('/', async (_req,res,next) => {
  try {
    await ensureComplianceProfiles();
    const devices = await prisma.device.findMany({
      where:{isActive:true,type:{in:['mikrotik','huawei_vrp']}},
      orderBy:{name:'asc'},
      select:{id:true,name:true,hostname:true,type:true,manufacturer:true,model:true,osVersion:true,compliancePolicy:true,complianceScans:{take:2,orderBy:{startedAt:'desc'},select:{id:true,profile:true,status:true,score:true,previousScore:true,passed:true,failed:true,regressions:true,recoveries:true,alertTaskId:true,error:true,type:true,startedAt:true,completedAt:true}},_count:{select:{complianceScans:true}}},
    });
    const latest = devices.map(item=>item.complianceScans[0]).filter(scan=>scan?.status==='completed');
    const activeExceptions=await prisma.complianceException.count({where:{revokedAt:null,startsAt:{lte:new Date()},expiresAt:{gt:new Date()}}});
    res.json({success:true,data:{profile:COMPLIANCE_PROFILE,devices,summary:{devices:devices.length,monitored:devices.filter(item=>item.compliancePolicy?.enabled).length,averageScore:latest.length?Math.round(latest.reduce((sum,item)=>sum+(item.score||0),0)/latest.length):0,nonCompliant:latest.filter(item=>(item.score||0)<80).length,activeExceptions}}});
  } catch(error){next(error);}
});

router.get('/dashboard', async(_req,res,next)=>{
  try{
    const since=new Date(Date.now()-30*86400000);
    const scans=await prisma.complianceScan.findMany({where:{status:'completed',startedAt:{gte:since}},include:{device:{select:{id:true,name:true,hostname:true,compliancePolicy:{select:{minimumScore:true}}}},findings:{select:{status:true,severity:true}}},orderBy:{startedAt:'desc'}});
    const latestMap=new Map();
    scans.forEach(scan=>{if(!latestMap.has(scan.deviceId))latestMap.set(scan.deviceId,scan);});
    const latest=[...latestMap.values()];
    const scores=latest.map(scan=>scan.score||0);
    const belowTarget=latest.filter(scan=>(scan.score||0)<(scan.device.compliancePolicy?.minimumScore||80));
    const criticalFindings=latest.reduce((sum,scan)=>sum+scan.findings.filter(item=>item.status==='non_compliant'&&item.severity==='critical').length,0);
    const expiring=await prisma.complianceException.findMany({where:{revokedAt:null,startsAt:{lte:new Date()},expiresAt:{gt:new Date(),lte:new Date(Date.now()+7*86400000)}},include:{device:{select:{name:true}}},orderBy:{expiresAt:'asc'},take:20});
    const days=new Map();
    scans.forEach(scan=>{const key=scan.startedAt.toLocaleDateString('sv-SE',{timeZone:'America/Porto_Velho'});const row=days.get(key)||{date:key,total:0,count:0};row.total+=scan.score||0;row.count++;days.set(key,row);});
    const trend=[...days.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(row=>({date:row.date,score:Math.round(row.total/row.count),scans:row.count}));
    res.json({success:true,data:{summary:{monitored:latest.length,averageScore:scores.length?Math.round(scores.reduce((sum,value)=>sum+value,0)/scores.length):0,belowTarget:belowTarget.length,criticalFindings,activeExceptions:await prisma.complianceException.count({where:{revokedAt:null,startsAt:{lte:new Date()},expiresAt:{gt:new Date()}}}),expiringExceptions:expiring.length},riskDevices:belowTarget.map(scan=>({id:scan.deviceId,name:scan.device.name,hostname:scan.device.hostname,score:scan.score,target:scan.device.compliancePolicy?.minimumScore||80,critical:scan.findings.filter(item=>item.status==='non_compliant'&&item.severity==='critical').length})).sort((a,b)=>a.score-b.score),expiring:expiring.map(item=>({id:item.id,device:item.device.name,ruleKey:item.ruleKey,expiresAt:item.expiresAt,approvedBy:item.approvedBy})),trend}});
  }catch(error){next(error);}
});

router.get('/profiles', async(req,res,next)=>{
  try { res.json({success:true,data:await getComplianceProfiles(req.query.deviceType ? String(req.query.deviceType) : undefined)}); }
  catch(error){next(error);}
});

router.post('/profiles', async(req,res,next)=>{
  try {
    await ensureComplianceProfiles();
    const deviceType=['mikrotik','huawei_vrp'].includes(req.body.deviceType)?req.body.deviceType:null;
    const name=String(req.body.name||'').trim().slice(0,100);
    if(!deviceType||name.length<3)return res.status(400).json({success:false,error:'Informe nome e fabricante válidos'});
    const template=await prisma.complianceProfile.findFirst({where:{deviceType,isSystem:true},include:{rules:{orderBy:{position:'asc'}}}});
    const profile=await prisma.complianceProfile.create({data:{name,description:String(req.body.description||'').trim().slice(0,500)||null,deviceType,minimumScore:Math.min(Math.max(Number(req.body.minimumScore)||80,1),100),createdBy:req.user.username,rules:{create:(template?.rules||[]).map(rule=>({ruleKey:rule.ruleKey,title:rule.title,category:rule.category,severity:rule.severity,enabled:rule.enabled,expectedValue:rule.expectedValue,recommendation:rule.recommendation,remediationPreview:rule.remediationPreview,position:rule.position}))}},include:{rules:{orderBy:{position:'asc'}},_count:{select:{policies:true}}}});
    await logAudit({...requestIdentity(req),action:'create',resource:'compliance_profile',resourceId:profile.id,status:'success',details:{name,deviceType,rules:profile.rules.length}});
    res.status(201).json({success:true,data:profile});
  } catch(error){next(error);}
});

router.put('/profiles/:id', async(req,res,next)=>{
  try {
    const current=await prisma.complianceProfile.findUnique({where:{id:req.params.id}});
    if(!current)return res.status(404).json({success:false,error:'Perfil não encontrado'});
    const name=current.isSystem?current.name:String(req.body.name??current.name).trim().slice(0,100);
    if(name.length<3)return res.status(400).json({success:false,error:'O nome deve ter pelo menos 3 caracteres'});
    await prisma.$transaction([
      prisma.complianceProfile.update({where:{id:current.id},data:{name,description:String(req.body.description??current.description??'').trim().slice(0,500)||null,minimumScore:Math.min(Math.max(Number(req.body.minimumScore)||current.minimumScore,1),100),isActive:req.body.isActive===undefined?current.isActive:Boolean(req.body.isActive)}}),
      ...(Array.isArray(req.body.rules)?req.body.rules.map((rule,position)=>prisma.complianceRule.update({where:{profileId_ruleKey:{profileId:current.id,ruleKey:String(rule.ruleKey)}},data:{title:String(rule.title||'').trim().slice(0,120),category:String(rule.category||'Geral').trim().slice(0,80),severity:['critical','high','medium','low'].includes(rule.severity)?rule.severity:'medium',enabled:rule.enabled!==false,expectedValue:String(rule.expectedValue||'').trim().slice(0,1000)||null,recommendation:String(rule.recommendation||'').trim().slice(0,1000),remediationPreview:String(rule.remediationPreview||'').trim().slice(0,2000)||null,position}})):[]),
    ]);
    const profile=await prisma.complianceProfile.findUnique({where:{id:current.id},include:{rules:{orderBy:{position:'asc'}},_count:{select:{policies:true}}}});
    await logAudit({...requestIdentity(req),action:'update',resource:'compliance_profile',resourceId:current.id,status:'success',details:{name:profile.name,rules:profile.rules.length}});
    res.json({success:true,data:profile});
  } catch(error){next(error);}
});

router.delete('/profiles/:id', async(req,res,next)=>{
  try {
    const profile=await prisma.complianceProfile.findUnique({where:{id:req.params.id},include:{_count:{select:{policies:true}}}});
    if(!profile)return res.status(404).json({success:false,error:'Perfil não encontrado'});
    if(profile.isSystem)return res.status(400).json({success:false,error:'O perfil padrão do sistema não pode ser excluído'});
    if(profile._count.policies)return res.status(409).json({success:false,error:'Remova o perfil das políticas antes de excluí-lo'});
    await prisma.complianceProfile.delete({where:{id:profile.id}});
    await logAudit({...requestIdentity(req),action:'delete',resource:'compliance_profile',resourceId:profile.id,status:'success',details:{name:profile.name}});
    res.json({success:true,message:'Perfil excluído'});
  } catch(error){next(error);}
});

router.get('/exceptions', async(req,res,next)=>{
  try {
    const rows=await prisma.complianceException.findMany({where:req.query.deviceId?{deviceId:String(req.query.deviceId)}:undefined,include:{device:{select:{name:true,hostname:true,type:true}}},orderBy:{createdAt:'desc'},take:500});
    const now=new Date();
    res.json({success:true,data:rows.map(item=>({...item,state:item.revokedAt?'revoked':item.expiresAt<=now?'expired':item.startsAt>now?'scheduled':'active'}))});
  } catch(error){next(error);}
});

router.get('/reports', async(req,res,next)=>{
  try {
    const report=await buildComplianceReport(req.query);
    res.json({success:true,data:{...report,scans:report.scans.map(scan=>({...scan,findings:undefined})),findings:undefined}});
  } catch(error){next(error);}
});

router.get('/reports/csv', async(req,res,next)=>{
  try {
    const report=await buildComplianceReport(req.query);
    const filename=`compliance-${new Date().toISOString().slice(0,10)}.csv`;
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition',`attachment; filename="${filename}"`);
    await logAudit({...requestIdentity(req),action:'export_csv',resource:'compliance',status:'success',details:{from:report.range.from,to:report.range.to,deviceId:report.filters.deviceId,scans:report.summary.scans}});
    res.end(complianceReportCsv(report));
  } catch(error){next(error);}
});

router.get('/reports/pdf', async(req,res,next)=>{
  try {
    const report=await buildComplianceReport(req.query);
    const filename=`compliance-${new Date().toISOString().slice(0,10)}.pdf`;
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition',`attachment; filename="${filename}"`);
    const pdf=await complianceReportPdf(report,await getBranding());
    await logAudit({...requestIdentity(req),action:'export_pdf',resource:'compliance',status:'success',details:{from:report.range.from,to:report.range.to,deviceId:report.filters.deviceId,scans:report.summary.scans}});
    res.end(pdf);
  } catch(error){next(error);}
});

router.get('/reports/package', async(req,res,next)=>{
  try{
    const report=await buildComplianceReport(req.query);
    const integrity=await verifyAuditChain();
    const manifest={
      schema:'noc-agent-compliance-audit-package/v1',
      generatedAt:new Date().toISOString(),
      generatedBy:req.user.username,
      range:{from:report.range.from.toISOString(),to:report.range.to.toISOString()},
      filters:report.filters,
      summary:report.summary,
      auditIntegrity:integrity,
      scans:report.scans.map(scan=>({
        id:scan.id,device:scan.device,profile:scan.profile,score:scan.score,previousScore:scan.previousScore,
        passed:scan.passed,failed:scan.failed,regressions:scan.regressions,recoveries:scan.recoveries,
        configurationSha256:scan.configurationSha256,startedAt:scan.startedAt,completedAt:scan.completedAt,
        findings:scan.findings,
      })),
      exceptions:report.exceptions,
    };
    const canonical=JSON.stringify(manifest);
    const sha256=crypto.createHash('sha256').update(canonical).digest('hex');
    const envelope={...manifest,integrity:{algorithm:'SHA-256',sha256,verification:'Calcule o SHA-256 do conteúdo JSON canônico sem o campo integrity.'}};
    const filename=`compliance-audit-${new Date().toISOString().slice(0,10)}-${sha256.slice(0,12)}.json`;
    await prisma.complianceAuditPackage.create({data:{filename,sha256,manifest:canonical,fromDate:report.range.from,toDate:report.range.to,deviceId:report.filters.deviceId,generatedBy:req.user.username}});
    await logAudit({...requestIdentity(req),action:'export_audit_package',resource:'compliance',status:'success',details:{filename,sha256,scans:report.summary.scans,auditIntegrity:integrity.valid}});
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.setHeader('Content-Disposition',`attachment; filename="${filename}"`);
    res.end(JSON.stringify(envelope,null,2));
  }catch(error){next(error);}
});

router.post('/exceptions', async(req,res,next)=>{
  try {
    await ensureComplianceProfiles();
    const device=await prisma.device.findUnique({where:{id:String(req.body.deviceId||'')}});
    if(!device||!['mikrotik','huawei_vrp'].includes(device.type))return res.status(404).json({success:false,error:'Equipamento compatível não encontrado'});
    const ruleKey=String(req.body.ruleKey||'').trim();
    const validRule=await prisma.complianceRule.findFirst({where:{ruleKey,profile:{deviceType:device.type}}});
    if(!validRule)return res.status(400).json({success:false,error:'Controle inválido para este equipamento'});
    const reason=String(req.body.reason||'').trim().slice(0,1000);
    if(reason.length<10)return res.status(400).json({success:false,error:'Informe uma justificativa com pelo menos 10 caracteres'});
    const startsAt=req.body.startsAt?new Date(req.body.startsAt):new Date();
    const expiresAt=new Date(req.body.expiresAt);
    if(Number.isNaN(startsAt.getTime())||Number.isNaN(expiresAt.getTime())||expiresAt<=startsAt||expiresAt>new Date(Date.now()+366*86400000))return res.status(400).json({success:false,error:'Informe um vencimento posterior ao início e limitado a 366 dias'});
    const duplicate=await prisma.complianceException.findFirst({where:{deviceId:device.id,ruleKey,revokedAt:null,expiresAt:{gt:new Date()}}});
    if(duplicate)return res.status(409).json({success:false,error:'Já existe uma exceção vigente ou agendada para este controle'});
    const exception=await prisma.complianceException.create({data:{deviceId:device.id,ruleKey,reason,approvedBy:req.user.username,startsAt,expiresAt},include:{device:{select:{name:true,hostname:true,type:true}}}});
    await logAudit({...requestIdentity(req),action:'approve_exception',resource:'compliance',resourceId:exception.id,status:'success',details:{deviceId:device.id,deviceName:device.name,ruleKey,startsAt,expiresAt,reason}});
    res.status(201).json({success:true,data:{...exception,state:startsAt>new Date()?'scheduled':'active'},message:'Exceção registrada'});
  } catch(error){next(error);}
});

router.delete('/exceptions/:id', async(req,res,next)=>{
  try {
    const current=await prisma.complianceException.findUnique({where:{id:req.params.id},include:{device:{select:{name:true}}}});
    if(!current)return res.status(404).json({success:false,error:'Exceção não encontrada'});
    if(current.revokedAt)return res.status(409).json({success:false,error:'Exceção já revogada'});
    const exception=await prisma.complianceException.update({where:{id:current.id},data:{revokedAt:new Date(),revokedBy:req.user.username}});
    await logAudit({...requestIdentity(req),action:'revoke_exception',resource:'compliance',resourceId:current.id,status:'success',details:{deviceId:current.deviceId,deviceName:current.device.name,ruleKey:current.ruleKey}});
    res.json({success:true,data:exception,message:'Exceção revogada'});
  } catch(error){next(error);}
});

router.post('/findings/:id/remediation-task', async(req,res,next)=>{
  try{
    const finding=await prisma.complianceFinding.findUnique({where:{id:req.params.id},include:{scan:{include:{device:true}}}});
    if(!finding)return res.status(404).json({success:false,error:'Controle não encontrado'});
    if(finding.status!=='non_compliant')return res.status(409).json({success:false,error:'Somente controles não conformes podem gerar correção'});
    if(!finding.remediationPreview)return res.status(400).json({success:false,error:'Este controle não possui uma correção sugerida'});
    const device=finding.scan.device;
    const incidentKey=`compliance-remediation:${device.id}:${finding.ruleKey}`;
    const existing=await prisma.task.findFirst({where:{incidentKey,status:{in:['pending','in_progress','diagnosing','awaiting_approval','executing']}},orderBy:{updatedAt:'desc'}});
    if(existing)return res.status(409).json({success:false,error:`Já existe a Task #${existing.taskNumber} aberta para este controle`});
    const originalMessage=[`Correção assistida de Compliance para ${device.name} (${device.hostname}).`,`Controle: ${finding.title}.`,`Severidade: ${finding.severity}.`,`Evidência: ${finding.evidence||'não informada'}.`,`Recomendação: ${finding.recommendation}.`,'Nenhum comando deve ser executado sem aprovação explícita do administrador.'].join('\n');
    let task=await createTask({source:'compliance',workType:'configuration',deviceId:device.id,priority:['critical','high'].includes(finding.severity)?finding.severity:'medium',originalMessage,incident:{incidentKey,incidentOpenedAt:new Date(),lastSeenAt:new Date()}});
    const proposedSolution=[`Correção do controle: ${finding.title}`,`Equipamento: ${device.name}`,`Comandos sugeridos:\n${finding.remediationPreview}`,'Valide o estado atual antes da aplicação e interrompa se houver divergência.'].join('\n\n');
    const needsPlanning=remediationNeedsPlanning(finding.remediationPreview);
    task=await updateTask(task.id,{status:needsPlanning?'pending':'awaiting_approval',diagnosis:`Não conformidade identificada pela verificação ${finding.scan.id}.\n${finding.evidence||''}`,proposedSolution:needsPlanning?null:proposedSolution,agentUsed:device.type});
    await addTaskMessage(task.id,'system',needsPlanning?`Correção assistida criada para ${finding.ruleKey}. O agente especialista deve preparar os valores específicos antes da aprovação.`:`Correção assistida criada a partir do controle ${finding.ruleKey}. Aguardando aprovação administrativa.`);
    await addTaskMessage(task.id,'agent',proposedSolution,device.type);
    await notifyTask(task,'opened',{message:needsPlanning?`Correção assistida criada; requer preparação do especialista: ${finding.title}`:`Correção assistida aguardando aprovação: ${finding.title}`,io:req.app.get('io')});
    await logAudit({...requestIdentity(req),action:'create_remediation_task',resource:'compliance',resourceId:finding.id,status:'success',details:{taskId:task.id,taskNumber:task.taskNumber,deviceId:device.id,ruleKey:finding.ruleKey}});
    res.status(201).json({success:true,data:task,message:`Task #${task.taskNumber} criada e aguardando aprovação`});
  }catch(error){next(error);}
});

router.put('/policies/:deviceId', async(req,res,next)=>{
  try {
    const policy=await saveCompliancePolicy(req.params.deviceId,req.body);
    await logAudit({...requestIdentity(req),action:'update_policy',resource:'compliance',resourceId:req.params.deviceId,status:'success',details:{enabled:policy.enabled,frequency:policy.frequency,hour:policy.hour,weekday:policy.weekday,profile:policy.profile}});
    res.json({success:true,data:policy});
  } catch(error){next(error);}
});

router.post('/scan/:deviceId', async(req,res,next)=>{
  try {
    const scan=await runComplianceScan(req.params.deviceId,{type:'manual',username:req.user.username});
    res.status(201).json({success:true,data:scan,message:'Verificação de compliance concluída'});
  } catch(error){next(error);}
});

router.get('/scans', async(req,res,next)=>{
  try {
    const scans=await prisma.complianceScan.findMany({where:req.query.deviceId?{deviceId:String(req.query.deviceId)}:undefined,orderBy:{startedAt:'desc'},take:Math.min(Math.max(Number(req.query.limit)||50,1),200),include:{device:{select:{name:true,hostname:true,type:true}}}});
    res.json({success:true,data:scans});
  } catch(error){next(error);}
});

router.get('/scans/:id', async(req,res,next)=>{
  try {
    const scan=await prisma.complianceScan.findUnique({where:{id:req.params.id},include:{device:{select:{name:true,hostname:true,type:true,model:true,osVersion:true}},findings:{orderBy:[{status:'desc'},{severity:'asc'},{category:'asc'}]}}});
    if(!scan)return res.status(404).json({success:false,error:'Verificação não encontrada'});
    res.json({success:true,data:scan});
  } catch(error){next(error);}
});

router.delete('/scans/:id', async(req,res,next)=>{
  try {
    await prisma.complianceScan.delete({where:{id:req.params.id}});
    await logAudit({...requestIdentity(req),action:'delete',resource:'compliance',resourceId:req.params.id,status:'success'});
    res.json({success:true,message:'Verificação removida'});
  } catch(error){next(error);}
});

export default router;
