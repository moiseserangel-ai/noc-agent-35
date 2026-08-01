import { Router } from 'express';
import prisma from '../database/client.js';
import { cmdbInclude, cmdbSummary, listCmdbAssets, normalizeCmdbAsset } from '../services/cmdb.service.js';
import { logAudit, requestIdentity } from '../services/audit.service.js';

const router = Router();
const actor = req => String(req.user?.name || req.user?.username || 'Administrador').slice(0, 100);

router.get('/summary', async (req,res,next) => { try { res.json({ success:true, data:await cmdbSummary(req.query.tenantId || null) }); } catch(error) { next(error); } });
router.get('/', async (req,res,next) => { try { res.json({ success:true, data:await listCmdbAssets(req.query) }); } catch(error) { next(error); } });

router.post('/sync-devices', async (req,res,next) => {
  try {
    const devices = await prisma.device.findMany({ where: { cmdbAsset: { is: null } }, include: { tenant:true, site:true } });
    const created=[];
    for (const device of devices) {
      const data=await normalizeCmdbAsset({ name:device.name,category:'network',status:device.isActive?'active':'maintenance',criticality:'high',tenantId:device.tenantId,siteId:device.siteId,deviceId:device.id,manufacturer:device.manufacturer,model:device.model,hostname:device.hostname,tags:[device.type,device.platform,device.capabilities].filter(Boolean).join(',') },actor(req));
      created.push(await prisma.cmdbAsset.create({data:{...data,createdBy:actor(req)}}));
    }
    await logAudit({...requestIdentity(req),action:'sync',resource:'cmdb_asset',status:'success',details:{created:created.length}});
    res.json({success:true,data:{created:created.length},message:`${created.length} equipamento(s) importado(s) para a CMDB`});
  } catch(error) { next(error); }
});

router.get('/:id',async(req,res,next)=>{try{const row=await prisma.cmdbAsset.findUnique({where:{id:req.params.id},include:cmdbInclude});if(!row)return res.status(404).json({success:false,error:'Ativo não encontrado'});res.json({success:true,data:row});}catch(error){next(error);}});
router.post('/',async(req,res,next)=>{try{const data=await normalizeCmdbAsset(req.body,actor(req));const row=await prisma.cmdbAsset.create({data:{...data,createdBy:actor(req)},include:cmdbInclude});await logAudit({...requestIdentity(req),action:'create',resource:'cmdb_asset',resourceId:row.id,details:{assetTag:row.assetTag,name:row.name,tenantId:row.tenantId}});res.status(201).json({success:true,data:row,message:'Ativo cadastrado na CMDB'});}catch(error){next(error);}});
router.put('/:id',async(req,res,next)=>{try{const current=await prisma.cmdbAsset.findUnique({where:{id:req.params.id}});if(!current)return res.status(404).json({success:false,error:'Ativo não encontrado'});const data=await normalizeCmdbAsset(req.body,actor(req),current);const row=await prisma.cmdbAsset.update({where:{id:current.id},data,include:cmdbInclude});await logAudit({...requestIdentity(req),action:'update',resource:'cmdb_asset',resourceId:row.id,details:{assetTag:row.assetTag,name:row.name,status:row.status}});res.json({success:true,data:row,message:'Ativo atualizado'});}catch(error){next(error);}});
router.delete('/:id',async(req,res,next)=>{try{const row=await prisma.cmdbAsset.findUnique({where:{id:req.params.id},select:{id:true,assetTag:true,name:true}});if(!row)return res.status(404).json({success:false,error:'Ativo não encontrado'});await prisma.cmdbAsset.delete({where:{id:row.id}});await logAudit({...requestIdentity(req),action:'delete',resource:'cmdb_asset',resourceId:row.id,details:{assetTag:row.assetTag,name:row.name}});res.json({success:true,message:'Ativo removido da CMDB'});}catch(error){next(error);}});

export default router;
