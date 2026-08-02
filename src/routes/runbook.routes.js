import { Router } from 'express';
import prisma from '../database/client.js';
import { logAudit, requestIdentity } from '../services/audit.service.js';
import { assessRunbookRisk, createSimulation, executeRunbook, prepareRunbookRollback, publicExecution, publicRunbook, renderRunbook, rollbackRunbook, runbookInputHash, validateRunbookDefinition } from '../services/runbook.service.js';
import { getRunbookTemplate, listRunbookTemplates } from '../services/runbook-template.service.js';
import { nextScheduleRun, protectScheduleVariables, publicSchedule, validateTimezone } from '../services/runbook-schedule.service.js';
import { createRunbookBatch, getRunbookBatch, listRunbookBatches, publicBatch, simulateRunbookBatch, startRunbookBatch } from '../services/runbook-batch.service.js';
import { notifyRunbookEvent } from '../services/notification.service.js';
import { compareConfigurations, decryptSnapshot } from '../services/device-backup.service.js';

const router=Router();
const actor=req=>req.user?.name||req.user?.username||'Sistema';
const actorId=req=>String(req.user?.sub||req.user?.id||req.user?.username||actor(req));
const definition=row=>({variables:JSON.parse(row.variables||'[]'),steps:JSON.parse(row.steps||'[]')});
const include={_count:{select:{executions:true}}};
const revisionData=(row,createdBy)=>({runbookId:row.id,version:row.version,name:row.name,description:row.description,category:row.category,deviceType:row.deviceType,riskLevel:row.riskLevel,variables:row.variables,steps:row.steps,createdBy});

router.get('/templates',async(req,res)=>res.json({success:true,data:listRunbookTemplates()}));

router.post('/templates/:key/import',async(req,res,next)=>{try{
  if(req.user.role!=='admin')return res.status(403).json({success:false,error:'Somente administradores podem importar modelos'});
  const template=getRunbookTemplate(req.params.key);
  if(!template)return res.status(404).json({success:false,error:'Modelo de runbook não encontrado'});
  const {key,...definition}=template;
  const input=validateRunbookDefinition(definition);
  const duplicate=await prisma.runbook.count({where:{name:input.name,status:{not:'archived'}}});
  const row=await prisma.runbook.create({data:{...input,name:duplicate?`${input.name} · Cópia ${duplicate+1}`:input.name,variables:JSON.stringify(input.variables),steps:JSON.stringify(input.steps),createdBy:actor(req),updatedBy:actor(req)},include});
  await logAudit({...requestIdentity(req),action:'import_template',resource:'runbook',resourceId:row.id,details:{template:key,name:row.name}});
  res.status(201).json({success:true,data:publicRunbook(row),message:'Modelo importado como rascunho para revisão'});
}catch(error){next(error);}});

router.get('/',async(req,res,next)=>{try{
  const where={...(req.user.role!=='admin'?{status:'published'}:req.query.status&&{status:String(req.query.status)}),...(req.query.deviceType&&{deviceType:{in:['any',String(req.query.deviceType)]}})};
  const rows=await prisma.runbook.findMany({where,include,orderBy:[{status:'asc'},{updatedAt:'desc'}]});
  res.json({success:true,data:rows.map(publicRunbook)});
}catch(error){next(error);}});

router.get('/executions',async(req,res,next)=>{try{
  const rows=await prisma.runbookExecution.findMany({where:{...(req.query.runbookId&&{runbookId:String(req.query.runbookId)}),...(req.query.deviceId&&{deviceId:String(req.query.deviceId)})},include:{runbook:{select:{name:true,version:true}},device:{select:{name:true,type:true}}},orderBy:{createdAt:'desc'},take:Math.min(Number(req.query.limit)||100,300)});
  res.json({success:true,data:rows.map(publicExecution)});
}catch(error){next(error);}});

router.get('/executions/:executionId/config-diff',async(req,res,next)=>{try{
  const execution=await prisma.runbookExecution.findUnique({where:{id:req.params.executionId},include:{beforeBackup:true,afterBackup:true,device:{select:{name:true,hostname:true}}}});
  if(!execution)return res.status(404).json({success:false,error:'Execução não encontrada'});
  if(!execution.beforeBackup||!execution.afterBackup)return res.status(409).json({success:false,error:'Esta execução não possui snapshots anterior e posterior'});
  const diff=compareConfigurations(decryptSnapshot(execution.beforeBackup),decryptSnapshot(execution.afterBackup));
  await logAudit({...requestIdentity(req),action:'compare_configuration',resource:'runbook_execution',resourceId:execution.id,details:{deviceId:execution.deviceId,beforeBackupId:execution.beforeBackupId,afterBackupId:execution.afterBackupId}});
  const meta=row=>({id:row.id,sha256:row.sha256,size:row.size,createdAt:row.createdAt,type:row.type});
  res.json({success:true,data:{executionId:execution.id,device:execution.device,changed:execution.configurationChanged,before:meta(execution.beforeBackup),after:meta(execution.afterBackup),diff}});
}catch(error){next(error);}});

router.get('/metrics',async(req,res,next)=>{try{
  const since=new Date(Date.now()-30*24*60*60_000);
  const [executions,byRunbook,byDeviceType]=await Promise.all([
    prisma.runbookExecution.findMany({where:{createdAt:{gte:since},mode:{in:['execution','rollback']}},select:{status:true,mode:true,createdAt:true,startedAt:true,completedAt:true}}),
    prisma.runbookExecution.groupBy({by:['runbookId'],where:{createdAt:{gte:since},mode:'execution'},_count:{_all:true},orderBy:{_count:{runbookId:'desc'}},take:8}),
    prisma.runbookExecution.findMany({where:{createdAt:{gte:since},mode:'execution'},select:{status:true,device:{select:{type:true}}}}),
  ]);
  const ids=byRunbook.map(item=>item.runbookId);const names=await prisma.runbook.findMany({where:{id:{in:ids}},select:{id:true,name:true}});
  const completed=executions.filter(item=>item.status==='completed').length;
  const durations=executions.filter(item=>item.startedAt&&item.completedAt).map(item=>item.completedAt-item.startedAt);
  const vendorMap={};for(const item of byDeviceType){const key=item.device.type;vendorMap[key]??={total:0,success:0};vendorMap[key].total++;if(item.status==='completed')vendorMap[key].success++;}
  res.json({success:true,data:{periodDays:30,total:executions.length,completed,failed:executions.length-completed,successRate:executions.length?Math.round(completed/executions.length*100):0,averageDurationMs:durations.length?Math.round(durations.reduce((a,b)=>a+b,0)/durations.length):0,topRunbooks:byRunbook.map(item=>({id:item.runbookId,name:names.find(row=>row.id===item.runbookId)?.name||'Runbook removido',executions:item._count._all})),vendors:Object.entries(vendorMap).map(([type,value])=>({type,...value,successRate:Math.round(value.success/value.total*100)}))}});
}catch(error){next(error);}});

router.get('/schedules',async(req,res,next)=>{try{
  const rows=await prisma.runbookSchedule.findMany({include:{runbook:{select:{name:true,version:true,riskLevel:true,status:true}},device:{select:{name:true,type:true,hostname:true}},executions:{select:{id:true,mode:true,status:true,error:true,createdAt:true},orderBy:{createdAt:'desc'},take:5}},orderBy:[{enabled:'desc'},{nextRunAt:'asc'}]});
  res.json({success:true,data:rows.map(publicSchedule)});
}catch(error){next(error);}});

router.get('/batches',async(req,res,next)=>{try{res.json({success:true,data:(await listRunbookBatches()).map(publicBatch)});}catch(error){next(error);}});
router.get('/batches/:batchId',async(req,res,next)=>{try{const row=await getRunbookBatch(req.params.batchId);if(!row)return res.status(404).json({success:false,error:'Lote não encontrado'});res.json({success:true,data:publicBatch(row)});}catch(error){next(error);}});
router.post('/batches',async(req,res,next)=>{try{
  const runbook=await prisma.runbook.findUnique({where:{id:String(req.body.runbookId||'')}});
  if(!runbook||runbook.status!=='published')return res.status(404).json({success:false,error:'Runbook publicado não encontrado'});
  const ids=[...new Set((Array.isArray(req.body.deviceIds)?req.body.deviceIds:[]).map(String))];
  const group=String(req.body.group||'').trim();
  const devices=await prisma.device.findMany({where:{isActive:true,...(group?{group}:ids.length?{id:{in:ids}}:{id:{in:[]}})}});
  const row=await createRunbookBatch({name:req.body.name,runbook,devices,variables:req.body.variables||{},createdBy:actor(req)});
  await logAudit({...requestIdentity(req),action:'create',resource:'runbook_batch',resourceId:row.id,details:{runbookId:runbook.id,totalTargets:row.totalTargets,group:group||null}});
  res.status(201).json({success:true,data:publicBatch(row),message:'Lote criado; execute a simulação antes de confirmar'});
}catch(error){next(error);}});
router.post('/batches/:batchId/simulate',async(req,res,next)=>{try{
  const row=await simulateRunbookBatch(req.params.batchId,actor(req));
  await logAudit({...requestIdentity(req),action:'simulate',resource:'runbook_batch',resourceId:row.id,details:{simulated:row.simulatedTargets,failed:row.failedTargets}});
  res.json({success:true,data:publicBatch(row),message:'Simulação do lote concluída; nenhum comando foi executado'});
}catch(error){next(error);}});
router.post('/batches/:batchId/execute',async(req,res,next)=>{try{
  if(req.user.role!=='admin'||req.body.confirmed!==true)return res.status(403).json({success:false,error:'Execução em lote exige administrador e confirmação explícita'});
  const row=await startRunbookBatch(req.params.batchId,actor(req));
  await logAudit({...requestIdentity(req),action:'start',resource:'runbook_batch',resourceId:row.id,details:{totalTargets:row.totalTargets,concurrency:row.concurrency,failureThreshold:row.failureThreshold}});
  res.status(202).json({success:true,data:publicBatch(row),message:'Execução em lote iniciada em segundo plano'});
}catch(error){next(error);}});

router.post('/schedules',async(req,res,next)=>{try{
  if(req.user.role!=='admin')return res.status(403).json({success:false,error:'Somente administradores podem criar agendamentos'});
  const [runbook,device]=await Promise.all([prisma.runbook.findUnique({where:{id:String(req.body.runbookId||'')}}),prisma.device.findFirst({where:{id:String(req.body.deviceId||''),isActive:true}})]);
  if(!runbook||runbook.status!=='published')return res.status(404).json({success:false,error:'Runbook publicado não encontrado'});
  if(!device)return res.status(404).json({success:false,error:'Equipamento ativo não encontrado'});
  if(runbook.deviceType!=='any'&&runbook.deviceType!==device.type)return res.status(400).json({success:false,error:'Runbook incompatível com o equipamento'});
  const mode=req.body.mode==='execution'?'execution':'simulation';
  if(mode==='execution'&&runbook.riskLevel!=='low')return res.status(409).json({success:false,error:'Agendamento automático de execução é permitido somente para Runbooks de baixo risco'});
  if(mode==='execution'&&req.body.confirmed!==true)return res.status(400).json({success:false,error:'Confirmação explícita obrigatória para execução automática'});
  const frequency=req.body.frequency==='weekly'?'weekly':'daily';
  const hour=Number(req.body.hour),minute=Number(req.body.minute),dayOfWeek=frequency==='weekly'?Number(req.body.dayOfWeek):null;
  const timezone=validateTimezone(req.body.timezone);
  const variables=req.body.variables||{};
  renderRunbook({...runbook,...definition(runbook)},variables,device);
  const nextRunAt=nextScheduleRun({frequency,hour,minute,dayOfWeek,timezone});
  const row=await prisma.runbookSchedule.create({data:{name:String(req.body.name||`${runbook.name} · ${device.name}`).trim().slice(0,120),runbookId:runbook.id,deviceId:device.id,mode,frequency,hour,minute,dayOfWeek,timezone,variables:protectScheduleVariables(variables),enabled:req.body.enabled!==false,nextRunAt,createdBy:actor(req)},include:{runbook:{select:{name:true,version:true,riskLevel:true,status:true}},device:{select:{name:true,type:true,hostname:true}}}});
  await logAudit({...requestIdentity(req),action:'create',resource:'runbook_schedule',resourceId:row.id,details:{runbookId:runbook.id,deviceId:device.id,mode,frequency,nextRunAt}});
  res.status(201).json({success:true,data:publicSchedule(row),message:'Agendamento criado'});
}catch(error){next(error);}});

router.patch('/schedules/:scheduleId',async(req,res,next)=>{try{
  if(req.user.role!=='admin')return res.status(403).json({success:false,error:'Somente administradores podem alterar agendamentos'});
  const current=await prisma.runbookSchedule.findUnique({where:{id:req.params.scheduleId}});
  if(!current)return res.status(404).json({success:false,error:'Agendamento não encontrado'});
  const enabled=req.body.enabled===true;
  const row=await prisma.runbookSchedule.update({where:{id:current.id},data:{enabled,nextRunAt:enabled?nextScheduleRun(current):current.nextRunAt}});
  await logAudit({...requestIdentity(req),action:enabled?'enable':'disable',resource:'runbook_schedule',resourceId:row.id});
  res.json({success:true,data:publicSchedule(row),message:enabled?'Agendamento ativado':'Agendamento pausado'});
}catch(error){next(error);}});

router.delete('/schedules/:scheduleId',async(req,res,next)=>{try{
  if(req.user.role!=='admin')return res.status(403).json({success:false,error:'Somente administradores podem excluir agendamentos'});
  const current=await prisma.runbookSchedule.findUnique({where:{id:req.params.scheduleId}});
  if(!current)return res.status(404).json({success:false,error:'Agendamento não encontrado'});
  await prisma.runbookSchedule.delete({where:{id:current.id}});
  await logAudit({...requestIdentity(req),action:'delete',resource:'runbook_schedule',resourceId:current.id,details:{name:current.name}});
  res.json({success:true,message:'Agendamento excluído'});
}catch(error){next(error);}});

router.get('/:id',async(req,res,next)=>{try{
  const row=await prisma.runbook.findUnique({where:{id:req.params.id},include:{...include,executions:{include:{device:{select:{name:true,type:true}}},orderBy:{createdAt:'desc'},take:30}}});
  if(!row)return res.status(404).json({success:false,error:'Runbook não encontrado'});
  if(req.user.role!=='admin'&&row.status!=='published')return res.status(404).json({success:false,error:'Runbook não encontrado'});
  res.json({success:true,data:publicRunbook(row)});
}catch(error){next(error);}});

router.post('/',async(req,res,next)=>{try{
  if(req.user.role!=='admin')return res.status(403).json({success:false,error:'Somente administradores podem criar runbooks'});
  const input=validateRunbookDefinition(req.body);
  const riskLevel=assessRunbookRisk(input);
  const row=await prisma.runbook.create({data:{...input,riskLevel,approvalStatus:riskLevel==='low'?'not_required':'pending',variables:JSON.stringify(input.variables),steps:JSON.stringify(input.steps),createdBy:actor(req),updatedBy:actor(req),...(riskLevel!=='low'&&{approvalRequestedBy:actor(req),approvalRequestedById:actorId(req),approvalRequestedAt:new Date()})},include});
  await prisma.runbookRevision.create({data:revisionData(row,actor(req))});
  if(riskLevel!=='low')await notifyRunbookEvent({resourceId:`approval:${row.id}:v${row.version}`,event:'approval_required',title:`Aprovação necessária: ${row.name}`,message:`Versão ${row.version}, risco ${riskLevel}, solicitada por ${actor(req)}.`,critical:riskLevel==='critical'}).catch(()=>{});
  await logAudit({...requestIdentity(req),action:'create',resource:'runbook',resourceId:row.id,details:{name:row.name,version:row.version}});
  res.status(201).json({success:true,data:publicRunbook(row)});
}catch(error){next(error);}});

router.put('/:id',async(req,res,next)=>{try{
  if(req.user.role!=='admin')return res.status(403).json({success:false,error:'Somente administradores podem editar runbooks'});
  const current=await prisma.runbook.findUnique({where:{id:req.params.id}});
  if(!current)return res.status(404).json({success:false,error:'Runbook não encontrado'});
  if(current.status==='archived')return res.status(409).json({success:false,error:'Runbook arquivado não pode ser editado'});
  const input=validateRunbookDefinition(req.body);
  const riskLevel=assessRunbookRisk(input);
  const row=await prisma.runbook.update({where:{id:current.id},data:{...input,riskLevel,approvalStatus:riskLevel==='low'?'not_required':'pending',approvalRequestedBy:riskLevel==='low'?null:actor(req),approvalRequestedById:riskLevel==='low'?null:actorId(req),approvalRequestedAt:riskLevel==='low'?null:new Date(),approvedBy:null,approvedById:null,approvedAt:null,rejectionReason:null,variables:JSON.stringify(input.variables),steps:JSON.stringify(input.steps),version:{increment:1},status:'draft',publishedAt:null,publishedBy:null,updatedBy:actor(req)},include});
  await prisma.runbookRevision.create({data:revisionData(row,actor(req))});
  await logAudit({...requestIdentity(req),action:'update',resource:'runbook',resourceId:row.id,details:{name:row.name,version:row.version}});
  res.json({success:true,data:publicRunbook(row)});
}catch(error){next(error);}});

router.get('/:id/revisions',async(req,res,next)=>{try{
  const runbook=await prisma.runbook.findUnique({where:{id:req.params.id}});
  if(!runbook)return res.status(404).json({success:false,error:'Runbook não encontrado'});
  await prisma.runbookRevision.upsert({where:{runbookId_version:{runbookId:runbook.id,version:runbook.version}},update:{},create:revisionData(runbook,runbook.updatedBy)});
  const rows=await prisma.runbookRevision.findMany({where:{runbookId:runbook.id},orderBy:{version:'desc'}});
  res.json({success:true,data:rows.map(row=>({...row,variables:JSON.parse(row.variables),steps:JSON.parse(row.steps)}))});
}catch(error){next(error);}});

router.get('/:id/compare',async(req,res,next)=>{try{
  const versions=[Number(req.query.from),Number(req.query.to)];
  if(versions.some(value=>!Number.isInteger(value)))return res.status(400).json({success:false,error:'Informe as versões para comparação'});
  const rows=await prisma.runbookRevision.findMany({where:{runbookId:req.params.id,version:{in:versions}}});
  if(rows.length!==2)return res.status(404).json({success:false,error:'Versões não encontradas'});
  const output=Object.fromEntries(rows.map(row=>[row.version,{...row,variables:JSON.parse(row.variables),steps:JSON.parse(row.steps)}]));
  res.json({success:true,data:{from:output[versions[0]],to:output[versions[1]]}});
}catch(error){next(error);}});

router.post('/:id/publish',async(req,res,next)=>{try{
  if(req.user.role!=='admin')return res.status(403).json({success:false,error:'Somente administradores podem publicar runbooks'});
  const current=await prisma.runbook.findUnique({where:{id:req.params.id}});
  if(!current)return res.status(404).json({success:false,error:'Runbook não encontrado'});
  validateRunbookDefinition({...current,...definition(current)});
  if(['high','critical'].includes(current.riskLevel)&&current.approvalStatus!=='approved')return res.status(409).json({success:false,error:'Runbook de alto risco precisa ser aprovado por outro administrador antes da publicação'});
  const row=await prisma.runbook.update({where:{id:current.id},data:{status:'published',publishedBy:actor(req),publishedAt:new Date(),updatedBy:actor(req)},include});
  await logAudit({...requestIdentity(req),action:'publish',resource:'runbook',resourceId:row.id,details:{name:row.name,version:row.version}});
  res.json({success:true,data:publicRunbook(row)});
}catch(error){next(error);}});

router.post('/:id/request-approval',async(req,res,next)=>{try{
  if(req.user.role!=='admin')return res.status(403).json({success:false,error:'Somente administradores podem solicitar aprovação'});
  const current=await prisma.runbook.findUnique({where:{id:req.params.id}});
  if(!current)return res.status(404).json({success:false,error:'Runbook não encontrado'});
  if(current.status!=='draft'||current.riskLevel==='low')return res.status(409).json({success:false,error:'Este runbook não exige aprovação independente'});
  const row=await prisma.runbook.update({where:{id:current.id},data:{approvalStatus:'pending',approvalRequestedBy:actor(req),approvalRequestedById:actorId(req),approvalRequestedAt:new Date(),approvedBy:null,approvedById:null,approvedAt:null,rejectionReason:null,updatedBy:actor(req)},include});
  await logAudit({...requestIdentity(req),action:'request_approval',resource:'runbook',resourceId:row.id,details:{riskLevel:row.riskLevel,version:row.version}});
  await notifyRunbookEvent({resourceId:`approval:${row.id}:v${row.version}`,event:'approval_required',title:`Aprovação necessária: ${row.name}`,message:`Versão ${row.version}, risco ${row.riskLevel}, solicitada por ${actor(req)}.`,critical:row.riskLevel==='critical'}).catch(()=>{});
  res.json({success:true,data:publicRunbook(row),message:'Aprovação solicitada a outro administrador'});
}catch(error){next(error);}});

router.post('/:id/approval',async(req,res,next)=>{try{
  if(req.user.role!=='admin')return res.status(403).json({success:false,error:'Somente administradores podem revisar runbooks'});
  const current=await prisma.runbook.findUnique({where:{id:req.params.id}});
  if(!current)return res.status(404).json({success:false,error:'Runbook não encontrado'});
  if(current.approvalStatus!=='pending')return res.status(409).json({success:false,error:'Este runbook não está aguardando aprovação'});
  if(current.approvalRequestedById===actorId(req))return res.status(409).json({success:false,error:'O solicitante não pode aprovar ou rejeitar o próprio runbook'});
  const approved=req.body.approved===true;
  const reason=String(req.body.reason||'').trim().slice(0,1000);
  if(!approved&&reason.length<5)return res.status(400).json({success:false,error:'Informe o motivo da rejeição'});
  const row=await prisma.runbook.update({where:{id:current.id},data:{approvalStatus:approved?'approved':'rejected',approvedBy:actor(req),approvedById:actorId(req),approvedAt:new Date(),rejectionReason:approved?null:reason,updatedBy:actor(req)},include});
  await logAudit({...requestIdentity(req),action:approved?'approve':'reject',resource:'runbook',resourceId:row.id,status:approved?'success':'failure',details:{riskLevel:row.riskLevel,version:row.version,reason:approved?undefined:reason}});
  res.json({success:true,data:publicRunbook(row),message:approved?'Runbook aprovado; já pode ser publicado':'Runbook rejeitado para revisão'});
}catch(error){next(error);}});

router.post('/:id/archive',async(req,res,next)=>{try{
  if(req.user.role!=='admin')return res.status(403).json({success:false,error:'Somente administradores podem arquivar runbooks'});
  const row=await prisma.runbook.update({where:{id:req.params.id},data:{status:'archived',updatedBy:actor(req)},include});
  await logAudit({...requestIdentity(req),action:'archive',resource:'runbook',resourceId:row.id,details:{name:row.name}});
  res.json({success:true,data:publicRunbook(row)});
}catch(error){next(error);}});

async function context(req){
  const [runbook,device]=await Promise.all([prisma.runbook.findUnique({where:{id:req.params.id}}),prisma.device.findFirst({where:{id:String(req.body.deviceId||''),isActive:true}})]);
  if(!runbook)throw Object.assign(new Error('Runbook não encontrado'),{statusCode:404});
  if(!device)throw Object.assign(new Error('Equipamento não encontrado ou inativo'),{statusCode:404});
  if(runbook.deviceType!=='any'&&runbook.deviceType!==device.type)throw Object.assign(new Error('Runbook incompatível com o equipamento'),{statusCode:400});
  const def={...runbook,...definition(runbook)};
  return{runbook,device,rendered:renderRunbook(def,req.body.variables||{},device)};
}

router.post('/:id/simulate',async(req,res,next)=>{try{
  const data=await context(req);
  if(req.user.role!=='admin'&&data.runbook.status!=='published')return res.status(409).json({success:false,error:'Operadores podem simular somente runbooks publicados'});
  const row=await createSimulation({...data,requestedBy:actor(req)});
  await logAudit({...requestIdentity(req),action:'simulate',resource:'runbook_execution',resourceId:row.id,details:{runbookId:data.runbook.id,deviceId:data.device.id,hasChanges:data.rendered.hasChanges}});
  res.json({success:true,data:publicExecution(row),message:'Simulação concluída; nenhum comando foi executado'});
}catch(error){next(error);}});

router.post('/:id/execute',async(req,res,next)=>{try{
  if(req.user.role!=='admin')return res.status(403).json({success:false,error:'Somente administradores podem executar runbooks'});
  if(req.body.confirmed!==true)return res.status(400).json({success:false,error:'Confirmação explícita obrigatória'});
  const data=await context(req);
  if(data.runbook.status!=='published')return res.status(409).json({success:false,error:'Somente runbooks publicados podem ser executados'});
  const inputHash=runbookInputHash(data.runbook.id,data.device.id,data.rendered.variables);
  const simulation=await prisma.runbookExecution.findFirst({where:{runbookId:data.runbook.id,deviceId:data.device.id,mode:'simulation',status:'completed',inputHash,createdAt:{gte:new Date(Date.now()-30*60_000)}},orderBy:{createdAt:'desc'}});
  if(!simulation)return res.status(409).json({success:false,error:'Execute uma simulação idêntica nos últimos 30 minutos antes da execução'});
  const row=await executeRunbook({...data,requestedBy:actor(req),approvedBy:actor(req)});
  await logAudit({...requestIdentity(req),action:'execute',resource:'runbook_execution',resourceId:row.id,status:row.status==='completed'?'success':'failure',details:{runbookId:data.runbook.id,deviceId:data.device.id,status:row.status}});
  res.json({success:true,data:publicExecution(row),message:row.status==='completed'?'Runbook concluído':'Runbook finalizado com falha'});
}catch(error){next(error);}});

router.post('/executions/:executionId/rollback/prepare',async(req,res,next)=>{try{
  if(req.user.role!=='admin')return res.status(403).json({success:false,error:'Somente administradores podem preparar rollback'});
  const execution=await prisma.runbookExecution.findUnique({where:{id:req.params.executionId},include:{device:true,beforeBackup:true,afterBackup:true}});
  if(!execution||execution.mode!=='execution'||execution.status!=='completed')return res.status(404).json({success:false,error:'Execução concluída não encontrada'});
  const row=await prepareRunbookRollback({execution,device:execution.device,requestedBy:actor(req)});
  await logAudit({...requestIdentity(req),action:'prepare_rollback',resource:'runbook_execution',resourceId:row.id,details:{sourceExecutionId:execution.id,deviceId:execution.deviceId}});
  const backup=row=>row?{id:row.id,sha256:row.sha256,size:row.size,createdAt:row.createdAt,type:row.type}:null;
  res.json({success:true,data:{...publicExecution(row),sourceExecutionId:execution.id,currentBackup:backup(execution.afterBackup),previousBackup:backup(execution.beforeBackup)},message:'Rollback preparado; revise os comandos antes de confirmar'});
}catch(error){next(error);}});

router.post('/executions/:executionId/rollback',async(req,res,next)=>{try{
  if(req.user.role!=='admin'||req.body.confirmed!==true)return res.status(403).json({success:false,error:'Rollback exige administrador e confirmação explícita'});
  const execution=await prisma.runbookExecution.findUnique({where:{id:req.params.executionId},include:{device:true}});
  if(!execution||execution.mode!=='execution')return res.status(404).json({success:false,error:'Execução não encontrada'});
  const preparation=await prisma.runbookExecution.findFirst({where:{id:String(req.body.preparationId||''),runbookId:execution.runbookId,deviceId:execution.deviceId,inputHash:execution.inputHash,mode:'rollback_simulation',status:'completed',createdAt:{gte:new Date(Date.now()-30*60_000)}}});
  if(!preparation)return res.status(409).json({success:false,error:'Prepare e revise o rollback nos últimos 30 minutos antes da execução'});
  const claimed=await prisma.runbookExecution.updateMany({where:{id:preparation.id,status:'completed'},data:{status:'consumed'}});
  if(!claimed.count)return res.status(409).json({success:false,error:'Esta preparação de rollback já foi utilizada'});
  const row=await rollbackRunbook({execution,preparation,device:execution.device,requestedBy:actor(req)});
  await logAudit({...requestIdentity(req),action:'rollback',resource:'runbook_execution',resourceId:row.id,status:row.status==='completed'?'success':'failure',details:{sourceExecutionId:execution.id,preparationId:preparation.id}});
  res.json({success:true,data:publicExecution(row),message:row.status==='completed'?'Rollback concluído':'Rollback falhou'});
}catch(error){next(error);}});

export default router;
