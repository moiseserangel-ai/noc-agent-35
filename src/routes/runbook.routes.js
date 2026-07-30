import { Router } from 'express';
import prisma from '../database/client.js';
import { logAudit, requestIdentity } from '../services/audit.service.js';
import { assessRunbookRisk, createSimulation, executeRunbook, publicExecution, publicRunbook, renderRunbook, rollbackRunbook, runbookInputHash, validateRunbookDefinition } from '../services/runbook.service.js';
import { getRunbookTemplate, listRunbookTemplates } from '../services/runbook-template.service.js';

const router=Router();
const actor=req=>req.user?.name||req.user?.username||'Sistema';
const actorId=req=>String(req.user?.sub||req.user?.id||req.user?.username||actor(req));
const definition=row=>({variables:JSON.parse(row.variables||'[]'),steps:JSON.parse(row.steps||'[]')});
const include={_count:{select:{executions:true}}};

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
  await logAudit({...requestIdentity(req),action:'update',resource:'runbook',resourceId:row.id,details:{name:row.name,version:row.version}});
  res.json({success:true,data:publicRunbook(row)});
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

router.post('/executions/:executionId/rollback',async(req,res,next)=>{try{
  if(req.user.role!=='admin'||req.body.confirmed!==true)return res.status(403).json({success:false,error:'Rollback exige administrador e confirmação explícita'});
  const execution=await prisma.runbookExecution.findUnique({where:{id:req.params.executionId},include:{device:true}});
  if(!execution||execution.mode!=='execution')return res.status(404).json({success:false,error:'Execução não encontrada'});
  const row=await rollbackRunbook({execution,device:execution.device,requestedBy:actor(req)});
  await logAudit({...requestIdentity(req),action:'rollback',resource:'runbook_execution',resourceId:row.id,status:row.status==='completed'?'success':'failure',details:{sourceExecutionId:execution.id}});
  res.json({success:true,data:publicExecution(row),message:row.status==='completed'?'Rollback concluído':'Rollback falhou'});
}catch(error){next(error);}});

export default router;
