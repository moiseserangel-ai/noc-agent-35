import {Router} from 'express';
import prisma from '../database/client.js';
import {getOnCallOverview,validTime,validateTimezone} from '../services/on-call.service.js';
import {logAudit,requestIdentity} from '../services/audit.service.js';

const router=Router();
const actor=req=>req.user?.name||req.user?.username||'Sistema';
const bad=message=>Object.assign(new Error(message),{statusCode:400});
const audit=(req,action,id,details)=>logAudit({...requestIdentity(req),action,resource:'on_call',resourceId:id,details});

router.get('/',async(_req,res,next)=>{try{
  const [teams,users,tenants]=await Promise.all([getOnCallOverview(),prisma.user.findMany({where:{isActive:true,role:{in:['admin','operator']}},orderBy:{name:'asc'},select:{id:true,name:true,username:true,role:true,tenantId:true}}),prisma.tenant.findMany({where:{isActive:true},orderBy:{name:'asc'},select:{id:true,name:true}})]);
  res.json({success:true,data:{teams,users,tenants,now:new Date()}});
}catch(error){next(error);}});

router.post('/teams',async(req,res,next)=>{try{
  const name=String(req.body.name||'').trim();if(name.length<3)throw bad('Informe o nome da equipe');
  const row=await prisma.onCallTeam.create({data:{name:name.slice(0,100),tenantId:req.body.tenantId||null,description:String(req.body.description||'').trim().slice(0,300)||null,timezone:validateTimezone(req.body.timezone),createdBy:actor(req)}});
  await audit(req,'create',row.id,{name:row.name});res.status(201).json({success:true,data:row,message:'Equipe criada'});
}catch(error){next(error);}});
router.put('/teams/:id',async(req,res,next)=>{try{
  const data={};if(req.body.name!==undefined)data.name=String(req.body.name).trim().slice(0,100);if(req.body.tenantId!==undefined)data.tenantId=req.body.tenantId||null;if(req.body.description!==undefined)data.description=String(req.body.description).trim().slice(0,300)||null;if(req.body.timezone!==undefined)data.timezone=validateTimezone(req.body.timezone);if(typeof req.body.enabled==='boolean')data.enabled=req.body.enabled;
  const row=await prisma.onCallTeam.update({where:{id:req.params.id},data});await audit(req,'update',row.id,data);res.json({success:true,data:row,message:'Equipe atualizada'});
}catch(error){next(error);}});
router.delete('/teams/:id',async(req,res,next)=>{try{await prisma.onCallTeam.delete({where:{id:req.params.id}});await audit(req,'delete',req.params.id,{});res.json({success:true,message:'Equipe excluída'});}catch(error){next(error);}});

router.post('/teams/:id/members',async(req,res,next)=>{try{
  const team=await prisma.onCallTeam.findUnique({where:{id:req.params.id}}),user=await prisma.user.findFirst({where:{id:String(req.body.userId),isActive:true}});if(!user||!team)throw bad('Usuário ou equipe inválida');if(team.tenantId&&user.tenantId&&user.tenantId!==team.tenantId)throw bad('Usuário pertence a outro cliente');
  const telegram=String(req.body.telegramChatId||'').trim()||null,whatsapp=String(req.body.whatsappNumber||'').replace(/\D/g,'')||null;
  if(!telegram&&!whatsapp)throw bad('Informe Telegram ou WhatsApp do plantonista');
  const row=await prisma.onCallMember.upsert({where:{teamId_userId:{teamId:req.params.id,userId:user.id}},update:{telegramChatId:telegram,whatsappNumber:whatsapp,priority:Number(req.body.priority)||100,enabled:req.body.enabled!==false},create:{teamId:req.params.id,userId:user.id,telegramChatId:telegram,whatsappNumber:whatsapp,priority:Number(req.body.priority)||100}});
  await audit(req,'member_upsert',row.id,{teamId:req.params.id,user:user.username});res.json({success:true,data:row,message:'Plantonista salvo'});
}catch(error){next(error);}});
router.delete('/members/:id',async(req,res,next)=>{try{await prisma.onCallMember.delete({where:{id:req.params.id}});await audit(req,'member_delete',req.params.id,{});res.json({success:true,message:'Plantonista removido'});}catch(error){next(error);}});

router.post('/teams/:id/shifts',async(req,res,next)=>{try{
  const day=Number(req.body.dayOfWeek),start=String(req.body.startTime),end=String(req.body.endTime);if(day<0||day>6||!validTime(start)||!validTime(end)||start===end)throw bad('Dia ou horário do turno inválido');
  const member=await prisma.onCallMember.findUnique({where:{teamId_userId:{teamId:req.params.id,userId:String(req.body.userId)}}});if(!member)throw bad('Adicione o usuário à equipe antes de criar o turno');
  const row=await prisma.onCallShift.create({data:{teamId:req.params.id,userId:member.userId,dayOfWeek:day,startTime:start,endTime:end}});await audit(req,'shift_create',row.id,{teamId:req.params.id,day,start,end});res.status(201).json({success:true,data:row,message:'Turno criado'});
}catch(error){next(error);}});
router.delete('/shifts/:id',async(req,res,next)=>{try{await prisma.onCallShift.delete({where:{id:req.params.id}});await audit(req,'shift_delete',req.params.id,{});res.json({success:true,message:'Turno removido'});}catch(error){next(error);}});

router.post('/teams/:id/overrides',async(req,res,next)=>{try{
  const startsAt=new Date(req.body.startsAt),endsAt=new Date(req.body.endsAt);if(!Number.isFinite(startsAt.getTime())||!Number.isFinite(endsAt.getTime())||endsAt<=startsAt)throw bad('Período da substituição inválido');
  const member=await prisma.onCallMember.findUnique({where:{teamId_userId:{teamId:req.params.id,userId:String(req.body.userId)}}});if(!member)throw bad('O substituto precisa pertencer à equipe');
  const row=await prisma.onCallOverride.create({data:{teamId:req.params.id,userId:member.userId,startsAt,endsAt,reason:String(req.body.reason||'').trim().slice(0,300)||null,createdBy:actor(req)}});await audit(req,'override_create',row.id,{teamId:req.params.id,startsAt,endsAt});res.status(201).json({success:true,data:row,message:'Substituição criada'});
}catch(error){next(error);}});
router.delete('/overrides/:id',async(req,res,next)=>{try{await prisma.onCallOverride.delete({where:{id:req.params.id}});await audit(req,'override_delete',req.params.id,{});res.json({success:true,message:'Substituição removida'});}catch(error){next(error);}});

export default router;
