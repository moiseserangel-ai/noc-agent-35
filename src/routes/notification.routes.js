import { Router } from 'express';
import prisma from '../database/client.js';
import { publicRule, validateNotificationRule } from '../services/notification-rule.service.js';
import { logAudit, requestIdentity } from '../services/audit.service.js';

const router=Router();
const actor=req=>req.user?.name||req.user?.username||'Sistema';

router.get('/',async(req,res,next)=>{try{
  const where={channel:'panel',...(req.query.unread==='true'&&{readAt:null}),...(req.query.priority&&{priority:String(req.query.priority)}),...(req.query.event&&{event:String(req.query.event)})};
  const [rows,unread]=await Promise.all([prisma.notificationLog.findMany({where,orderBy:{createdAt:'desc'},take:Math.min(Number(req.query.limit)||100,300)}),prisma.notificationLog.count({where:{channel:'panel',readAt:null}})]);
  res.json({success:true,data:{rows,unread}});
}catch(error){next(error);}});

router.post('/read-all',async(req,res,next)=>{try{
  const now=new Date();const result=await prisma.notificationLog.updateMany({where:{channel:'panel',readAt:null},data:{readAt:now,readBy:actor(req)}});
  res.json({success:true,data:{updated:result.count},message:'Notificações marcadas como lidas'});
}catch(error){next(error);}});

router.post('/:id/read',async(req,res,next)=>{try{
  const row=await prisma.notificationLog.findFirst({where:{id:req.params.id,channel:'panel'}});
  if(!row)return res.status(404).json({success:false,error:'Notificação não encontrada'});
  res.json({success:true,data:await prisma.notificationLog.update({where:{id:row.id},data:{readAt:new Date(),readBy:actor(req)}})});
}catch(error){next(error);}});

router.get('/rules/list',async(req,res,next)=>{try{
  if(req.user.role!=='admin')return res.status(403).json({success:false,error:'Somente administradores podem visualizar regras'});
  const rows=await prisma.notificationRule.findMany({orderBy:[{sortOrder:'asc'},{createdAt:'asc'}]});res.json({success:true,data:rows.map(publicRule)});
}catch(error){next(error);}});
router.post('/rules',async(req,res,next)=>{try{
  if(req.user.role!=='admin')return res.status(403).json({success:false,error:'Somente administradores podem criar regras'});
  const input=validateNotificationRule(req.body,actor(req));if(input.name.length<3)return res.status(400).json({success:false,error:'Informe o nome da regra'});
  const row=await prisma.notificationRule.create({data:input});await logAudit({...requestIdentity(req),action:'create',resource:'notification_rule',resourceId:row.id,details:{name:row.name}});
  res.status(201).json({success:true,data:publicRule(row),message:'Regra criada'});
}catch(error){next(error);}});
router.put('/rules/:id',async(req,res,next)=>{try{
  if(req.user.role!=='admin')return res.status(403).json({success:false,error:'Somente administradores podem editar regras'});
  const current=await prisma.notificationRule.findUnique({where:{id:req.params.id}});if(!current)return res.status(404).json({success:false,error:'Regra não encontrada'});
  const input=validateNotificationRule(req.body,current.createdBy);const row=await prisma.notificationRule.update({where:{id:current.id},data:input});res.json({success:true,data:publicRule(row),message:'Regra atualizada'});
}catch(error){next(error);}});
router.delete('/rules/:id',async(req,res,next)=>{try{
  if(req.user.role!=='admin')return res.status(403).json({success:false,error:'Somente administradores podem excluir regras'});
  await prisma.notificationRule.delete({where:{id:req.params.id}});res.json({success:true,message:'Regra excluída'});
}catch(error){next(error);}});

export default router;
