import { Router } from 'express';
import { capacityDashboard, collectCapacity } from '../services/capacity.service.js';
import { logAudit, requestIdentity } from '../services/audit.service.js';

const router=Router();

router.get('/',async(req,res,next)=>{
  try{res.json({success:true,data:await capacityDashboard(req.query.days,req.user.tenantId)});}
  catch(error){next(error);}
});

router.post('/collect',async(req,res,next)=>{
  try{
    if(req.user.role!=='admin')return res.status(403).json({success:false,error:'Somente administradores podem iniciar a coleta'});
    const result=await collectCapacity({username:req.user.username});
    res.json({success:true,data:result,message:`Métricas coletadas de ${result.collected} equipamento(s)`});
  }catch(error){next(error);}
});

router.get('/export.csv',async(req,res,next)=>{
  try{
    const dashboard=await capacityDashboard(req.query.days,req.user.tenantId);
    const safe=value=>`"${String(value??'').replaceAll('"','""')}"`;
    const rows=[['Equipamento','Endereço','Grupo','Disponibilidade período','Disponível agora','CPU %','Memória %','Armazenamento %','Tráfego entrada','Tráfego saída','Coletado em']];
    dashboard.rows.forEach(row=>rows.push([row.name,row.hostname,row.group||'',row.availability30d,row.latest?.availability,row.latest?.cpu,row.latest?.memory,row.latest?.storage,row.latest?.trafficIn,row.latest?.trafficOut,row.latest?.collectedAt||'']));
    await logAudit({...requestIdentity(req),action:'export_csv',resource:'capacity',status:'success',details:{devices:dashboard.rows.length,days:Number(req.query.days)||30}});
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition',`attachment; filename="capacidade-${new Date().toISOString().slice(0,10)}.csv"`);
    res.end(Buffer.from(`\ufeff${rows.map(row=>row.map(safe).join(';')).join('\r\n')}`,'utf8'));
  }catch(error){next(error);}
});

export default router;
