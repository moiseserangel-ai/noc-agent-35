import { Router } from 'express';
import prisma from '../database/client.js';

const router = Router();

router.get('/sessions', async (req, res, next) => {
  try {
    const sessions = await prisma.chatSession.findMany({
      orderBy: { updatedAt: 'desc' },
      include: { messages: { take: 1, orderBy: { createdAt: 'desc' } } },
    });
    res.json({ success: true, data: sessions });
  } catch (err) { next(err); }
});

router.post('/sessions', async (req, res, next) => {
  try {
    const { title } = req.body;
    const session = await prisma.chatSession.create({
      data: { title: title || `Chat ${new Date().toLocaleString('pt-BR')}` },
    });
    res.status(201).json({ success: true, data: session });
  } catch (err) { next(err); }
});

router.get('/sessions/:id/messages', async (req, res, next) => {
  try {
    const messages = await prisma.chatMessage.findMany({
      where: { sessionId: req.params.id },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ success: true, data: messages });
  } catch (err) { next(err); }
});

router.delete('/sessions/:id', async (req, res, next) => {
  try {
    await prisma.chatSession.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Session deleted' });
  } catch (err) { next(err); }
});

router.patch('/messages/:id/feedback',async(req,res,next)=>{try{const feedback=['positive','negative'].includes(req.body.feedback)?req.body.feedback:null;const message=await prisma.chatMessage.findFirst({where:{id:req.params.id,role:'assistant'},select:{id:true}});if(!message)return res.status(404).json({success:false,error:'Resposta não encontrada'});const updated=await prisma.chatMessage.update({where:{id:message.id},data:{feedback}});res.json({success:true,data:updated,message:feedback?'Avaliação registrada':'Avaliação removida'});}catch(error){next(error);}});

export default router;
