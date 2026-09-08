import { Router } from 'express';
import prisma from '../database/client.js';
import { createTopologyLink, saveTopologyPositions, topologyDashboard } from '../services/topology.service.js';
import { approveTopologyNeighbor, ignoreTopologyNeighbor, startTopologyDiscovery, topologyDiscoveryDashboard } from '../services/topology-discovery.service.js';
import { logAudit, requestIdentity } from '../services/audit.service.js';
import { cmdbOperationalContext } from '../services/cmdb-operational-context.service.js';
import { captureTopologySnapshot, compareTopologySnapshots, createTopologyChangeTask, listTopologySnapshots, setTopologyBaseline } from '../services/topology-history.service.js';
import { topologyPdf } from '../services/topology-export.service.js';
import { collectTopologyLinkTelemetry, topologyLinkTelemetryHistory, updateTopologyLinkPolicy } from '../services/topology-telemetry.service.js';

const router = Router();
const admin = (req, res, next) => req.user.role === 'admin' ? next() : res.status(403).json({ success: false, error: 'Somente administradores podem editar o mapa' });

router.get('/', async (req, res, next) => {
  try { res.json({ success: true, data: await topologyDashboard(req.user.tenantId) }); } catch (error) { next(error); }
});

router.get('/impact/:deviceId',async(req,res,next)=>{try{const device=await prisma.device.findFirst({where:{id:req.params.deviceId,isActive:true,...(req.user.tenantId&&{tenantId:req.user.tenantId})},select:{id:true}});if(!device)return res.status(404).json({success:false,error:'Equipamento não encontrado'});res.json({success:true,data:await cmdbOperationalContext([device.id])});}catch(error){next(error);}});
router.get('/history',admin,async(req,res,next)=>{try{res.json({success:true,data:await listTopologySnapshots()});}catch(error){next(error);}});
router.post('/history',admin,async(req,res,next)=>{try{const row=await captureTopologySnapshot({source:'manual',createdBy:req.user.username,baseline:req.body.baseline===true});await logAudit({...requestIdentity(req),action:'snapshot',resource:'topology',resourceId:row.id,status:'success',details:{baseline:row.isBaseline,nodeCount:row.nodeCount,linkCount:row.linkCount}});res.status(201).json({success:true,data:row,message:row.isBaseline?'Baseline da topologia criado':'Snapshot da topologia criado'});}catch(error){next(error);}});
router.post('/history/:id/baseline',admin,async(req,res,next)=>{try{const row=await setTopologyBaseline(req.params.id);await logAudit({...requestIdentity(req),action:'set_baseline',resource:'topology',resourceId:row.id,status:'success'});res.json({success:true,data:row,message:'Baseline da topologia atualizado'});}catch(error){next(error);}});
router.get('/history/compare',admin,async(req,res,next)=>{try{res.json({success:true,data:await compareTopologySnapshots(String(req.query.from||''),String(req.query.to||''))});}catch(error){next(error);}});
router.post('/history/change-task',admin,async(req,res,next)=>{try{const result=await createTopologyChangeTask(String(req.body.from||''),String(req.body.to||''),req.user.username);res.status(result.existing?200:201).json({success:true,data:{id:result.task.id,taskNumber:result.task.taskNumber},message:result.existing?`Task #TASK-${result.task.taskNumber} já acompanha esta mudança`:`Task #TASK-${result.task.taskNumber} criada`});}catch(error){next(error);}});
router.post('/export.pdf',admin,async(req,res,next)=>{try{const pdf=await topologyPdf(req.body);await logAudit({...requestIdentity(req),action:'export_pdf',resource:'topology',status:'success',details:{scope:req.body.scope||'network',devices:Array.isArray(req.body.deviceIds)?req.body.deviceIds.length:null}});res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`attachment; filename="mapa-rede-${new Date().toISOString().slice(0,10)}.pdf"`);res.send(pdf);}catch(error){next(error);}});
router.post('/telemetry/collect',admin,async(req,res,next)=>{try{const result=await collectTopologyLinkTelemetry({username:req.user.username});res.json({success:true,data:result,message:`Telemetria coletada para ${result.collected} conexão(ões)`});}catch(error){next(error);}});
router.get('/links/:id/telemetry',async(req,res,next)=>{try{if(req.user.tenantId){const link=await prisma.topologyLink.findFirst({where:{id:req.params.id,sourceDevice:{tenantId:req.user.tenantId},targetDevice:{tenantId:req.user.tenantId}},select:{id:true}});if(!link)return res.status(404).json({success:false,error:'Conexão não encontrada'});}res.json({success:true,data:await topologyLinkTelemetryHistory(req.params.id,req.query.hours)});}catch(error){next(error);}});
router.patch('/links/:id/policy',admin,async(req,res,next)=>{try{const row=await updateTopologyLinkPolicy(req.params.id,req.body);await logAudit({...requestIdentity(req),action:'update_policy',resource:'topology_link',resourceId:row.id,status:'success',details:req.body});res.json({success:true,data:row,message:'Política de monitoramento atualizada'});}catch(error){next(error);}});

router.get('/discovery', admin, async (req,res,next)=>{
  try{res.json({success:true,data:await topologyDiscoveryDashboard()});}catch(error){next(error);}
});

router.post('/discovery', admin, async (req,res,next)=>{
  try{
    const run=await startTopologyDiscovery(req.user.username);
    await logAudit({...requestIdentity(req),action:'start_discovery',resource:'topology',resourceId:run.id,status:'success'});
    res.status(202).json({success:true,data:run,message:'Descoberta LLDP/MNDP iniciada'});
  }catch(error){next(error);}
});

router.post('/discovery/:id/approve', admin, async(req,res,next)=>{
  try{
    const link=await approveTopologyNeighbor(req.params.id,req.user.username);
    await captureTopologySnapshot({source:'discovery',createdBy:req.user.username});
    await logAudit({...requestIdentity(req),action:'approve_neighbor',resource:'topology',resourceId:req.params.id,status:'success',details:{linkId:link.id}});
    res.json({success:true,data:link,message:'Conexão descoberta adicionada ao mapa'});
  }catch(error){next(error);}
});

router.post('/discovery/:id/ignore', admin, async(req,res,next)=>{
  try{
    await ignoreTopologyNeighbor(req.params.id,req.user.username);
    await logAudit({...requestIdentity(req),action:'ignore_neighbor',resource:'topology',resourceId:req.params.id,status:'success'});
    res.json({success:true,message:'Sugestão ignorada'});
  }catch(error){next(error);}
});

router.put('/positions', admin, async (req, res, next) => {
  try {
    const result = await saveTopologyPositions(req.body.positions, req.user.username);
    await logAudit({ ...requestIdentity(req), action: 'save_positions', resource: 'topology', status: 'success', details: result });
    res.json({ success: true, data: result });
  } catch (error) { next(error); }
});

router.post('/links', admin, async (req, res, next) => {
  try {
    const link = await createTopologyLink(req.body, req.user.username);
    await captureTopologySnapshot({source:'link_change',createdBy:req.user.username});
    await logAudit({ ...requestIdentity(req), action: 'create_link', resource: 'topology', resourceId: link.id, status: 'success', details: { sourceDeviceId: link.sourceDeviceId, targetDeviceId: link.targetDeviceId, linkType: link.linkType } });
    res.status(201).json({ success: true, data: link, message: 'Conexão adicionada ao mapa' });
  } catch (error) {
    if (error.code === 'P2002') return res.status(409).json({ success: false, error: 'Essa conexão já existe no mapa' });
    next(error);
  }
});

router.delete('/links/:id', admin, async (req, res, next) => {
  try {
    const link = await prisma.topologyLink.findUnique({ where: { id: req.params.id } });
    if (!link) return res.status(404).json({ success: false, error: 'Conexão não encontrada' });
    await prisma.topologyLink.delete({ where: { id: link.id } });
    await captureTopologySnapshot({source:'link_change',createdBy:req.user.username});
    await logAudit({ ...requestIdentity(req), action: 'delete_link', resource: 'topology', resourceId: link.id, status: 'success' });
    res.json({ success: true, message: 'Conexão removida' });
  } catch (error) { next(error); }
});

export default router;
