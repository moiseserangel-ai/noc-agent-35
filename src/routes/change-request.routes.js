import { Router } from 'express';
import prisma from '../database/client.js';
import { calculateChangeRisk, changeInclude, createRollbackTasks, nextChangeNumber, prepareChange, recordChangeEvent, validateChangeWindow, validateExecutedChange } from '../services/change-request.service.js';
import { logAudit, requestIdentity } from '../services/audit.service.js';

const router = Router();
const actor = req => req.user?.name || req.user?.username || 'Sistema';
const clean = (value,max=4000) => String(value||'').trim().slice(0,max);
const allowedTypes = ['standard','normal','emergency'];

router.get('/',async(req,res,next)=>{
  try{
    const where={};
    if(req.query.status)where.status=String(req.query.status);
    if(req.query.type)where.changeType=String(req.query.type);
    const rows=await prisma.changeRequest.findMany({where,include:changeInclude,orderBy:{createdAt:'desc'},take:Math.min(Math.max(Number(req.query.limit)||100,1),500)});
    const summary=await prisma.changeRequest.groupBy({by:['status'],_count:{_all:true}});
    res.json({success:true,data:{rows,summary:Object.fromEntries(summary.map(item=>[item.status,item._count._all]))}});
  }catch(error){next(error);}
});

router.get('/:id',async(req,res,next)=>{
  try{
    const row=await prisma.changeRequest.findUnique({where:{id:req.params.id},include:changeInclude});
    if(!row)return res.status(404).json({success:false,error:'Mudança não encontrada'});
    res.json({success:true,data:row});
  }catch(error){next(error);}
});

router.post('/',async(req,res,next)=>{
  try{
    const deviceIds=[...new Set((Array.isArray(req.body.deviceIds)?req.body.deviceIds:[]).map(String))];
    const devices=await prisma.device.findMany({where:{id:{in:deviceIds},isActive:true,type:{in:['mikrotik','huawei_vrp']}}});
    if(!devices.length||devices.length!==deviceIds.length)return res.status(400).json({success:false,error:'Selecione equipamentos MikroTik ou Huawei ativos'});
    const input={
      title:clean(req.body.title,140),description:clean(req.body.description),reason:clean(req.body.reason,2000),
      impact:clean(req.body.impact,2000),executionPlan:clean(req.body.executionPlan,6000),
      validationPlan:clean(req.body.validationPlan,4000),rollbackPlan:clean(req.body.rollbackPlan,6000),
      changeType:allowedTypes.includes(req.body.changeType)?req.body.changeType:'normal',
      windowStart:req.body.windowStart,windowEnd:req.body.windowEnd,
    };
    if(input.title.length<5||input.description.length<10||input.reason.length<10||input.impact.length<10||input.executionPlan.length<20||input.validationPlan.length<15||input.rollbackPlan.length<20)return res.status(400).json({success:false,error:'Preencha objetivo, motivo, impacto e os planos com detalhes suficientes'});
    const window=validateChangeWindow(input.windowStart,input.windowEnd);
    if(input.changeType!=='emergency'&&!window.start)return res.status(400).json({success:false,error:'Mudanças normais e padrão exigem janela de manutenção'});
    const risk=calculateChangeRisk(input,devices.length);
    const task=req.body.taskId?await prisma.task.findUnique({where:{id:String(req.body.taskId)}}):null;
    const row=await prisma.changeRequest.create({data:{
      number:await nextChangeNumber(),title:input.title,description:input.description,reason:input.reason,changeType:input.changeType,
      riskLevel:risk.level,riskScore:risk.score,impact:input.impact,executionPlan:input.executionPlan,validationPlan:input.validationPlan,
      rollbackPlan:input.rollbackPlan,windowStart:window.start,windowEnd:window.end,requestedBy:actor(req),assignedTo:clean(req.body.assignedTo,100)||null,
      taskId:task?.id||null,devices:{create:devices.map(device=>({deviceId:device.id}))},
    },include:changeInclude});
    await recordChangeEvent(row.id,'created',actor(req),{risk,deviceIds});
    await logAudit({...requestIdentity(req),action:'create',resource:'change_request',resourceId:row.id,status:'success',details:{number:row.number,risk,deviceIds}});
    res.status(201).json({success:true,data:row,message:`RFC-${String(row.number).padStart(5,'0')} criada`});
  }catch(error){next(error);}
});

router.put('/:id',async(req,res,next)=>{
  try{
    const current=await prisma.changeRequest.findUnique({where:{id:req.params.id},include:{devices:true}});
    if(!current)return res.status(404).json({success:false,error:'Mudança não encontrada'});
    if(!['draft','rejected'].includes(current.status))return res.status(409).json({success:false,error:'Somente mudanças em rascunho ou rejeitadas podem ser editadas'});
    const data={};
    for(const [field,max] of Object.entries({title:140,description:4000,reason:2000,impact:2000,executionPlan:6000,validationPlan:4000,rollbackPlan:6000,assignedTo:100}))if(req.body[field]!==undefined)data[field]=clean(req.body[field],max)||null;
    if(req.body.changeType!==undefined)data.changeType=allowedTypes.includes(req.body.changeType)?req.body.changeType:current.changeType;
    const window=validateChangeWindow(req.body.windowStart??current.windowStart,req.body.windowEnd??current.windowEnd);
    data.windowStart=window.start;data.windowEnd=window.end;
    const risk=calculateChangeRisk({...current,...data},current.devices.length);Object.assign(data,{riskScore:risk.score,riskLevel:risk.level,status:'draft',rejectedBy:null,rejectedAt:null,rejectionReason:null});
    const row=await prisma.changeRequest.update({where:{id:current.id},data,include:changeInclude});
    await recordChangeEvent(row.id,'updated',actor(req),{risk});
    await logAudit({...requestIdentity(req),action:'update',resource:'change_request',resourceId:row.id,status:'success',details:{number:row.number,risk}});
    res.json({success:true,data:row});
  }catch(error){next(error);}
});

router.post('/:id/submit',async(req,res,next)=>{
  try{
    const current=await prisma.changeRequest.findUnique({where:{id:req.params.id}});
    if(!current||!['draft','rejected'].includes(current.status))return res.status(409).json({success:false,error:'A mudança não pode ser enviada neste estado'});
    const row=await prisma.changeRequest.update({where:{id:current.id},data:{status:'awaiting_approval'},include:changeInclude});
    await recordChangeEvent(row.id,'submitted',actor(req));
    await logAudit({...requestIdentity(req),action:'submit',resource:'change_request',resourceId:row.id,status:'success',details:{number:row.number}});
    res.json({success:true,data:row,message:'Mudança enviada para aprovação'});
  }catch(error){next(error);}
});

router.post('/:id/approval',async(req,res,next)=>{
  try{
    if(req.user.role!=='admin')return res.status(403).json({success:false,error:'Somente administradores podem aprovar mudanças'});
    const current=await prisma.changeRequest.findUnique({where:{id:req.params.id},include:changeInclude});
    if(!current||current.status!=='awaiting_approval')return res.status(409).json({success:false,error:'A mudança não está aguardando aprovação'});
    if(req.body.approved!==true){
      const reason=clean(req.body.reason,1000);
      if(reason.length<5)return res.status(400).json({success:false,error:'Informe o motivo da rejeição'});
      const row=await prisma.changeRequest.update({where:{id:current.id},data:{status:'rejected',rejectedBy:actor(req),rejectedAt:new Date(),rejectionReason:reason},include:changeInclude});
      await recordChangeEvent(row.id,'rejected',actor(req),{reason});
      await logAudit({...requestIdentity(req),action:'reject',resource:'change_request',resourceId:row.id,status:'success',details:{number:row.number,reason}});
      return res.json({success:true,data:row,message:'Mudança rejeitada'});
    }
    const backups=await prepareChange(current,actor(req));
    const row=await prisma.changeRequest.update({where:{id:current.id},data:{status:'approved',approvedBy:actor(req),approvedAt:new Date(),rejectedBy:null,rejectedAt:null,rejectionReason:null},include:changeInclude});
    await recordChangeEvent(row.id,'approved',actor(req),{backups});
    await logAudit({...requestIdentity(req),action:'approve',resource:'change_request',resourceId:row.id,status:'success',details:{number:row.number,risk:row.riskLevel,backups}});
    res.json({success:true,data:row,message:'Mudança aprovada e backups prévios concluídos'});
  }catch(error){next(error);}
});

router.post('/:id/start',async(req,res,next)=>{
  try{
    const current=await prisma.changeRequest.findUnique({where:{id:req.params.id}});
    if(!current||current.status!=='approved')return res.status(409).json({success:false,error:'Somente mudanças aprovadas podem ser iniciadas'});
    const now=new Date();
    if(current.changeType!=='emergency'&&(now<current.windowStart||now>current.windowEnd))return res.status(409).json({success:false,error:'A mudança está fora da janela de manutenção aprovada'});
    const row=await prisma.changeRequest.update({where:{id:current.id},data:{status:'in_progress',startedAt:now},include:changeInclude});
    await recordChangeEvent(row.id,'started',actor(req));
    await logAudit({...requestIdentity(req),action:'start',resource:'change_request',resourceId:row.id,status:'success',details:{number:row.number}});
    res.json({success:true,data:row,message:'Janela de execução iniciada'});
  }catch(error){next(error);}
});

router.post('/:id/validate',async(req,res,next)=>{
  try{
    const current=await prisma.changeRequest.findUnique({where:{id:req.params.id},include:changeInclude});
    if(!current||!['in_progress','failed_validation'].includes(current.status))return res.status(409).json({success:false,error:'A mudança não está pronta para validação'});
    await prisma.changeRequest.update({where:{id:current.id},data:{status:'validating'}});
    const result=await validateExecutedChange(current,actor(req));
    await logAudit({...requestIdentity(req),action:'validate',resource:'change_request',resourceId:current.id,status:result.passed?'success':'failure',details:{number:current.number,results:result.results}});
    res.json({success:true,data:await prisma.changeRequest.findUnique({where:{id:current.id},include:changeInclude}),message:result.passed?'Mudança validada e concluída':'Validação falhou; avalie o rollback'});
  }catch(error){await prisma.changeRequest.update({where:{id:req.params.id},data:{status:'failed_validation'}}).catch(()=>{});next(error);}
});

router.post('/:id/rollback',async(req,res,next)=>{
  try{
    if(req.user.role!=='admin')return res.status(403).json({success:false,error:'Somente administradores podem solicitar rollback'});
    const current=await prisma.changeRequest.findUnique({where:{id:req.params.id},include:changeInclude});
    if(!current||!['in_progress','failed_validation','completed'].includes(current.status))return res.status(409).json({success:false,error:'Rollback indisponível neste estado'});
    const taskIds=await createRollbackTasks(current,actor(req));
    await logAudit({...requestIdentity(req),action:'request_rollback',resource:'change_request',resourceId:current.id,status:'success',details:{number:current.number,taskIds}});
    res.json({success:true,data:await prisma.changeRequest.findUnique({where:{id:current.id},include:changeInclude}),message:`${taskIds.length} Task(s) de rollback criada(s)`});
  }catch(error){next(error);}
});

router.post('/:id/cancel',async(req,res,next)=>{
  try{
    const current=await prisma.changeRequest.findUnique({where:{id:req.params.id}});
    if(!current||!['draft','awaiting_approval','approved'].includes(current.status))return res.status(409).json({success:false,error:'A mudança não pode ser cancelada neste estado'});
    const row=await prisma.changeRequest.update({where:{id:current.id},data:{status:'cancelled'},include:changeInclude});
    await recordChangeEvent(row.id,'cancelled',actor(req),{reason:clean(req.body.reason,1000)});
    await logAudit({...requestIdentity(req),action:'cancel',resource:'change_request',resourceId:row.id,status:'success',details:{number:row.number}});
    res.json({success:true,data:row});
  }catch(error){next(error);}
});

export default router;
