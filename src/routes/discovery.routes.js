import { Router } from 'express';
import prisma from '../database/client.js';
import { encrypt } from '../utils/crypto.js';
import { expandPrivateCidr, normalizeDiscoveryPorts, startDiscoveryJob } from '../services/discovery.service.js';
import { logAudit, requestIdentity } from '../services/audit.service.js';

const router=Router();

router.get('/',async(_req,res,next)=>{
  try{
    const [jobs,summary]=await Promise.all([
      prisma.discoveryJob.findMany({orderBy:{createdAt:'desc'},take:50,include:{hosts:{orderBy:[{state:'asc'},{ipAddress:'asc'}],include:{existingDevice:{select:{id:true,name:true}}}}}}),
      Promise.all([
        prisma.discoveryHost.count(),
        prisma.discoveryHost.count({where:{state:'new'}}),
        prisma.discoveryHost.count({where:{state:'imported'}}),
        prisma.discoveryHost.count({where:{state:'known'}}),
      ]),
    ]);
    res.json({success:true,data:{jobs,summary:{discovered:summary[0],new:summary[1],imported:summary[2],known:summary[3]}}});
  }catch(error){next(error);}
});

router.post('/',async(req,res,next)=>{
  try{
    if(req.body.confirmed!==true)return res.status(400).json({success:false,error:'Confirme explicitamente a descoberta da faixa informada'});
    const addresses=expandPrivateCidr(req.body.cidr);
    const ports=normalizeDiscoveryPorts(req.body.ports);
    const active=await prisma.discoveryJob.findFirst({where:{status:{in:['queued','running']}}});
    if(active)return res.status(409).json({success:false,error:'Já existe uma descoberta em andamento'});
    const timeoutMs=Math.min(Math.max(Number(req.body.timeoutMs)||900,250),3000);
    const job=await prisma.discoveryJob.create({data:{cidr:String(req.body.cidr).trim(),ports:ports.join(','),timeoutMs,totalHosts:addresses.length,createdBy:req.user.username}});
    await logAudit({...requestIdentity(req),action:'create',resource:'network_discovery',resourceId:job.id,status:'success',details:{cidr:job.cidr,ports,totalHosts:job.totalHosts,timeoutMs}});
    startDiscoveryJob(job.id);
    res.status(202).json({success:true,data:job,message:`Descoberta iniciada em ${addresses.length} endereço(s)`});
  }catch(error){next(error);}
});

router.post('/:id/cancel',async(req,res,next)=>{
  try{
    const job=await prisma.discoveryJob.findUnique({where:{id:req.params.id}});
    if(!job||!['queued','running'].includes(job.status))return res.status(409).json({success:false,error:'A descoberta não está em execução'});
    const updated=await prisma.discoveryJob.update({where:{id:job.id},data:{status:'cancelled',completedAt:new Date()}});
    await logAudit({...requestIdentity(req),action:'cancel',resource:'network_discovery',resourceId:job.id,status:'success'});
    res.json({success:true,data:updated,message:'Cancelamento solicitado'});
  }catch(error){next(error);}
});

router.post('/hosts/:id/import',async(req,res,next)=>{
  try{
    const host=await prisma.discoveryHost.findUnique({where:{id:req.params.id}});
    if(!host)return res.status(404).json({success:false,error:'Host descoberto não encontrado'});
    if(['known','imported'].includes(host.state))return res.status(409).json({success:false,error:'O host já está cadastrado'});
    const name=String(req.body.name||'').trim().slice(0,100);
    const username=String(req.body.username||'').trim().slice(0,100);
    const password=String(req.body.password||'');
    const type=['mikrotik','huawei_vrp','linux'].includes(req.body.type)?req.body.type:host.detectedType;
    if(name.length<2||!username||password.length<1||!type)return res.status(400).json({success:false,error:'Informe nome, tipo e credenciais do equipamento'});
    const duplicate=await prisma.device.findFirst({where:{OR:[{hostname:host.ipAddress},{name}]}});
    if(duplicate)return res.status(409).json({success:false,error:`Equipamento já cadastrado como ${duplicate.name}`});
    const device=await prisma.device.create({data:{name,hostname:host.ipAddress,port:Number(req.body.port)||22,type,manufacturer:host.manufacturer,username,password:encrypt(password),group:String(req.body.group||'').trim().slice(0,100)||null,notes:`Importado pela descoberta ${host.jobId}. Portas observadas: ${host.openPorts}.`}});
    await prisma.discoveryHost.update({where:{id:host.id},data:{state:'imported',existingDeviceId:device.id,importedAt:new Date()}});
    await logAudit({...requestIdentity(req),action:'import',resource:'network_discovery',resourceId:host.id,status:'success',details:{deviceId:device.id,name,hostname:host.ipAddress,type}});
    res.status(201).json({success:true,data:{...device,password:undefined},message:'Equipamento importado para o inventário'});
  }catch(error){next(error);}
});

router.post('/hosts/:id/ignore',async(req,res,next)=>{
  try{
    const host=await prisma.discoveryHost.update({where:{id:req.params.id},data:{state:'ignored'}});
    await logAudit({...requestIdentity(req),action:'ignore',resource:'network_discovery',resourceId:host.id,status:'success',details:{ipAddress:host.ipAddress}});
    res.json({success:true,data:host});
  }catch(error){next(error);}
});

router.delete('/:id',async(req,res,next)=>{
  try{
    const job=await prisma.discoveryJob.findUnique({where:{id:req.params.id}});
    if(!job)return res.status(404).json({success:false,error:'Descoberta não encontrada'});
    if(['queued','running'].includes(job.status))return res.status(409).json({success:false,error:'Cancele a descoberta antes de excluí-la'});
    await prisma.discoveryJob.delete({where:{id:job.id}});
    await logAudit({...requestIdentity(req),action:'delete',resource:'network_discovery',resourceId:job.id,status:'success',details:{cidr:job.cidr}});
    res.json({success:true,message:'Histórico de descoberta excluído'});
  }catch(error){next(error);}
});

export default router;
