import { Router } from 'express';
import prisma from '../database/client.js';
import { createTopologyLink, saveTopologyPositions, topologyDashboard } from '../services/topology.service.js';
import { approveTopologyNeighbor, ignoreTopologyNeighbor, startTopologyDiscovery, topologyDiscoveryDashboard } from '../services/topology-discovery.service.js';
import { logAudit, requestIdentity } from '../services/audit.service.js';
import { cmdbOperationalContext } from '../services/cmdb-operational-context.service.js';

const router = Router();
const admin = (req, res, next) => req.user.role === 'admin' ? next() : res.status(403).json({ success: false, error: 'Somente administradores podem editar o mapa' });

router.get('/', async (req, res, next) => {
  try { res.json({ success: true, data: await topologyDashboard() }); } catch (error) { next(error); }
});

router.get('/impact/:deviceId',async(req,res,next)=>{try{const device=await prisma.device.findFirst({where:{id:req.params.deviceId,isActive:true,...(req.user.tenantId&&{tenantId:req.user.tenantId})},select:{id:true}});if(!device)return res.status(404).json({success:false,error:'Equipamento não encontrado'});res.json({success:true,data:await cmdbOperationalContext([device.id])});}catch(error){next(error);}});

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
    await logAudit({ ...requestIdentity(req), action: 'delete_link', resource: 'topology', resourceId: link.id, status: 'success' });
    res.json({ success: true, message: 'Conexão removida' });
  } catch (error) { next(error); }
});

export default router;
