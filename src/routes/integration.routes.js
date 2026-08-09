import { Router } from 'express';
import { logAudit, requestIdentity } from '../services/audit.service.js';
import { ansibleInventory, testNetboxConnection } from '../services/integration.service.js';

const router=Router();
router.get('/ansible/inventory',async(req,res,next)=>{try{const data=await ansibleInventory();await logAudit({...requestIdentity(req),action:'export',resource:'ansible_inventory',details:{count:data.count}});res.json({success:true,data});}catch(error){next(error);}});
router.post('/netbox/test',async(req,res,next)=>{try{const data=await testNetboxConnection();await logAudit({...requestIdentity(req),action:'test',resource:'netbox',status:'success',details:data});res.json({success:true,data,message:'Conexão com NetBox funcionando'});}catch(error){await logAudit({...requestIdentity(req),action:'test',resource:'netbox',status:'failure',details:{error:error.message}});next(error);}});
export default router;
