import { Router } from 'express';
import prisma from '../database/client.js';
import * as taskService from '../services/task.service.js';
import { chatMarkdown, chatPdf, extractChatAttachment } from '../services/chat-document.service.js';

const router = Router();
const sessionScope=req=>req.user.tenantId?{ownerId:req.user.sub,tenantId:req.user.tenantId}:{tenantId:null,OR:[{ownerId:req.user.sub},{ownerId:null}]};
const findSession=(req,id,select)=>prisma.chatSession.findFirst({where:{id,...sessionScope(req)},...(select&&{select})});

router.get('/sessions', async (req, res, next) => {
  try {
    const sessions = await prisma.chatSession.findMany({
      where:sessionScope(req),orderBy: { updatedAt: 'desc' },
      include: { messages: { take: 1, orderBy: { createdAt: 'desc' } } },
    });
    res.json({ success: true, data: sessions });
  } catch (err) { next(err); }
});

router.post('/sessions', async (req, res, next) => {
  try {
    const { title } = req.body;
    const session = await prisma.chatSession.create({
      data: { title: title || `Chat ${new Date().toLocaleString('pt-BR')}`,ownerId:req.user.sub,tenantId:req.user.tenantId||null },
    });
    res.status(201).json({ success: true, data: session });
  } catch (err) { next(err); }
});

router.patch('/sessions/:id',async(req,res,next)=>{try{
  const session=await findSession(req,req.params.id,{id:true});
  if(!session)return res.status(404).json({success:false,error:'Conversa não encontrada'});
  const data={};
  if(Object.hasOwn(req.body,'title')){const title=String(req.body.title||'').trim().replace(/\s+/g,' ').slice(0,100);if(!title)return res.status(400).json({success:false,error:'Informe um nome para a conversa'});data.title=title;}
  if(Object.hasOwn(req.body,'archived'))data.archivedAt=req.body.archived===true?new Date():null;
  if(!Object.keys(data).length)return res.status(400).json({success:false,error:'Nenhuma alteração informada'});
  const updated=await prisma.chatSession.update({where:{id:session.id},data,include:{messages:{take:1,orderBy:{createdAt:'desc'}}}});
  res.json({success:true,data:updated,message:data.archivedAt?'Conversa arquivada':data.archivedAt===null&&Object.hasOwn(req.body,'archived')?'Conversa restaurada':'Conversa renomeada'});
}catch(error){next(error);}});

router.get('/sessions/:id/messages', async (req, res, next) => {
  try {
    if(!await findSession(req,req.params.id,{id:true}))return res.status(404).json({success:false,error:'Conversa não encontrada'});
    const messages = await prisma.chatMessage.findMany({
      where: { sessionId: req.params.id },
      orderBy: { createdAt: 'asc' },include:{attachments:{select:{id:true,filename:true,mimeType:true,size:true,authorizedForAi:true}}},
    });
    res.json({ success: true, data: messages });
  } catch (err) { next(err); }
});

router.post('/sessions/:id/attachments',async(req,res,next)=>{try{const session=await findSession(req,req.params.id,{id:true,archivedAt:true});if(!session)return res.status(404).json({success:false,error:'Conversa não encontrada'});if(session.archivedAt)return res.status(409).json({success:false,error:'Restaure a conversa antes de anexar arquivos'});const extracted=await extractChatAttachment(req.body);const row=await prisma.chatAttachment.create({data:{sessionId:session.id,...extracted,authorizedForAi:req.body.authorizedForAi===true},select:{id:true,filename:true,mimeType:true,size:true,authorizedForAi:true}});res.status(201).json({success:true,data:row,message:row.authorizedForAi?'Anexo pronto para ser enviado à IA na próxima mensagem':'Anexo armazenado sem autorização de envio à IA'});}catch(error){next(error);}});

router.delete('/attachments/:id',async(req,res,next)=>{try{const row=await prisma.chatAttachment.findFirst({where:{id:req.params.id,session:sessionScope(req)},select:{id:true,messageId:true}});if(!row)return res.status(404).json({success:false,error:'Anexo não encontrado'});if(row.messageId)return res.status(409).json({success:false,error:'O anexo já faz parte do histórico'});await prisma.chatAttachment.delete({where:{id:row.id}});res.json({success:true,message:'Anexo removido'});}catch(error){next(error);}});

router.get('/sessions/:id/export.:format',async(req,res,next)=>{try{if(!['md','pdf'].includes(req.params.format))return res.status(400).json({success:false,error:'Formato inválido'});const session=await findSession(req,req.params.id);if(!session)return res.status(404).json({success:false,error:'Conversa não encontrada'});const messages=await prisma.chatMessage.findMany({where:{sessionId:session.id},orderBy:{createdAt:'asc'},include:{attachments:{select:{filename:true}}}}),base=String(session.title||'chat-ai').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9_-]+/gi,'-').replace(/^-|-$/g,'').slice(0,80)||'chat-ai';if(req.params.format==='md'){res.setHeader('Content-Type','text/markdown; charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename="${base}.md"`);return res.send(chatMarkdown(session,messages))}const pdf=await chatPdf(session,messages);res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`attachment; filename="${base}.pdf"`);res.send(pdf);}catch(error){next(error);}});

router.delete('/sessions/:id', async (req, res, next) => {
  try {
    if(!await findSession(req,req.params.id,{id:true}))return res.status(404).json({success:false,error:'Conversa não encontrada'});
    await prisma.chatSession.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Conversa excluída permanentemente' });
  } catch (err) { next(err); }
});

router.patch('/messages/:id/feedback',async(req,res,next)=>{try{const feedback=['positive','negative'].includes(req.body.feedback)?req.body.feedback:null;const message=await prisma.chatMessage.findFirst({where:{id:req.params.id,role:'assistant',session:sessionScope(req)},select:{id:true}});if(!message)return res.status(404).json({success:false,error:'Resposta não encontrada'});const updated=await prisma.chatMessage.update({where:{id:message.id},data:{feedback}});res.json({success:true,data:updated,message:feedback?'Avaliação registrada':'Avaliação removida'});}catch(error){next(error);}});

router.post('/messages/:id/task',async(req,res,next)=>{try{
  const message=await prisma.chatMessage.findFirst({where:{id:req.params.id,role:'assistant',session:sessionScope(req)},include:{session:true}});
  if(!message)return res.status(404).json({success:false,error:'Resposta do Chat AI não encontrada'});
  const deviceId=message.deviceId||req.body.deviceId;
  if(!deviceId)return res.status(400).json({success:false,error:'Fixe um equipamento antes de criar a Task'});
  const device=await prisma.device.findFirst({where:{id:String(deviceId),isActive:true,...(req.user.tenantId&&{tenantId:req.user.tenantId})},select:{id:true,name:true}});
  if(!device)return res.status(404).json({success:false,error:'Equipamento não encontrado ou inativo'});
  const existing=await prisma.task.findFirst({where:{source:`chat:${message.id}`},select:{id:true,taskNumber:true}});
  if(existing)return res.json({success:true,data:existing,message:`Task #TASK-${existing.taskNumber} já criada`});
  const task=await taskService.createTask({source:`chat:${message.id}`,deviceId:device.id,priority:req.body.priority||'medium',workType:req.body.workType||'consultation',originalMessage:`Revisar a resposta do Chat AI e decidir a execução no equipamento ${device.name}.\n\n${message.content}`});
  await taskService.addTaskMessage(task.id,'system',`Origem: conversa "${message.session?.title||'Chat AI'}". A Task requer revisão humana e não executa alterações automaticamente.`);
  res.status(201).json({success:true,data:{id:task.id,taskNumber:task.taskNumber},message:`Task #TASK-${task.taskNumber} criada para revisão`});
}catch(error){next(error);}});

export default router;
