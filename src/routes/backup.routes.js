import { Router } from 'express';
import prisma from '../database/client.js';
import { createBackup, getBackupConfig, listBackups, restoreBackup, safeBackupPath, verifyBackup } from '../services/backup.service.js';
import { verifyPassword } from '../services/user.service.js';
import { logAudit, requestIdentity } from '../services/audit.service.js';

const router = Router();
router.get('/status', async (_req, res, next) => { try { const backups = await listBackups(); res.json({ success: true, data: { lastBackup: backups[0] || null, total: backups.length, config: await getBackupConfig() } }); } catch(e) { next(e); } });
router.get('/', async (_req, res, next) => { try { res.json({ success: true, data: await listBackups(), config: await getBackupConfig() }); } catch(e) { next(e); } });
router.put('/config', async (req, res, next) => { try {
  const enabled = req.body.enabled === true || req.body.enabled === 'true'; const hour = Math.min(Math.max(Number(req.body.hour) || 0, 0), 23); const retention = Math.min(Math.max(Number(req.body.retention) || 7, 1), 90);
  for (const [key,value] of Object.entries({ backup_enabled:String(enabled), backup_hour:String(hour), backup_retention:String(retention) })) await prisma.settings.upsert({ where:{key},update:{value,encrypted:false},create:{key,value,encrypted:false} });
  await logAudit({ ...requestIdentity(req), action:'update_backup_policy', resource:'backup', status:'success', details:{enabled,hour,retention} });
  res.json({success:true,data:{enabled,hour,retention}});
} catch(e){next(e);} });
router.post('/', async (req, res, next) => { try { const backup=await createBackup('manual'); await logAudit({...requestIdentity(req),action:'create',resource:'backup',resourceId:backup.filename,status:'success',details:{size:backup.size}}); res.status(201).json({success:true,data:backup}); } catch(e){next(e);} });
router.get('/:filename/download', async (req,res,next) => { try { const path=safeBackupPath(req.params.filename); await verifyBackup(path); await logAudit({...requestIdentity(req),action:'download',resource:'backup',resourceId:req.params.filename,status:'success'}); res.download(path,req.params.filename); } catch(e){next(e);} });
router.post('/:filename/restore', async (req,res,next) => { try {
  const user=await prisma.user.findUnique({where:{id:req.user.sub}}); if(!user || !(await verifyPassword(req.body.password,user.passwordHash))) return res.status(400).json({success:false,error:'Senha do administrador incorreta'});
  await verifyBackup(safeBackupPath(req.params.filename));
  const identity=requestIdentity(req); const safety=await restoreBackup(req.params.filename);
  await logAudit({...identity,action:'restore',resource:'backup',resourceId:req.params.filename,status:'success',details:{serviceRestart:true,safetyBackup:safety.filename}});
  res.json({success:true,message:'Backup restaurado. O serviço será reiniciado.',safetyBackup:safety.filename});
  setTimeout(()=>process.exit(75),750).unref();
} catch(e){next(e);} });
export default router;
