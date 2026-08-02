import { Router } from 'express';
import prisma from '../database/client.js';
import { compareConfigurations, decryptSnapshot, runDeviceBackup, saveDeviceBackupPolicy, SUPPORTED_BACKUP_TYPES } from '../services/device-backup.service.js';
import { logAudit, requestIdentity } from '../services/audit.service.js';
import { decideConfigurationDrift, publicDrift } from '../services/config-drift.service.js';

const router = Router();
const snapshotSelect = {
  id: true, deviceId: true, type: true, status: true, sha256: true, size: true,
  deviceName: true, hostname: true, deviceType: true, manufacturer: true, model: true,
  osVersion: true, error: true, createdBy: true, createdAt: true,
};

router.get('/', async (_req, res, next) => {
  try {
    const devices = await prisma.device.findMany({
      where: { isActive: true, type: { in: SUPPORTED_BACKUP_TYPES } },
      orderBy: { name: 'asc' },
      select: {
        id: true, name: true, hostname: true, type: true, manufacturer: true, model: true, osVersion: true,
        backupPolicy: true,
        configBackups: { take: 1, orderBy: { createdAt: 'desc' }, select: snapshotSelect },
        _count: { select: { configBackups: { where: { status: 'success' } } } },
      },
    });
    const success = await prisma.deviceConfigBackup.count({ where: { status: 'success' } });
    const failed = await prisma.deviceConfigBackup.count({ where: { status: 'failed', createdAt: { gte: new Date(Date.now() - 30 * 86400_000) } } });
    res.json({ success: true, data: { devices, summary: { devices: devices.length, protected: devices.filter(item => item.backupPolicy?.enabled).length, backups: success, failures30d: failed } } });
  } catch (error) { next(error); }
});

router.get('/snapshots', async (req, res, next) => {
  try {
    const snapshots = await prisma.deviceConfigBackup.findMany({
      where: req.query.deviceId ? { deviceId: String(req.query.deviceId) } : undefined,
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(Number(req.query.limit) || 100, 1), 500),
      select: snapshotSelect,
    });
    res.json({ success: true, data: snapshots });
  } catch (error) { next(error); }
});

router.get('/drifts',async(req,res,next)=>{try{const where=req.query.status&&req.query.status!=='all'?{status:String(req.query.status)}:{};const rows=await prisma.configDrift.findMany({where,include:{device:{select:{id:true,name:true,hostname:true,type:true}},},orderBy:{detectedAt:'desc'},take:300});const summary=await prisma.configDrift.groupBy({by:['status'],_count:{_all:true}});res.json({success:true,data:{rows:rows.map(publicDrift),summary:Object.fromEntries(summary.map(item=>[item.status,item._count._all]))}});}catch(error){next(error);}});

router.post('/drifts/:id/decision',async(req,res,next)=>{try{if(!['acknowledge','resolve','ignore'].includes(req.body.action))return res.status(400).json({success:false,error:'Decisão inválida'});const row=await decideConfigurationDrift(req.params.id,{action:req.body.action,actor:req.user.username,resolution:req.body.resolution});res.json({success:true,data:publicDrift(row),message:req.body.action==='acknowledge'?'Drift reconhecido':'Drift concluído'});}catch(error){next(error);}});

router.put('/policies/:deviceId', async (req, res, next) => {
  try {
    const policy = await saveDeviceBackupPolicy(req.params.deviceId, req.body);
    await logAudit({ ...requestIdentity(req), action: 'update_policy', resource: 'device_backup', resourceId: req.params.deviceId, status: 'success', details: { enabled: policy.enabled, frequency: policy.frequency, hour: policy.hour, weekday: policy.weekday, retention: policy.retention } });
    res.json({ success: true, data: policy });
  } catch (error) { next(error); }
});

router.post('/run/:deviceId', async (req, res, next) => {
  try {
    const snapshot = await runDeviceBackup(req.params.deviceId, { type: 'manual', username: req.user.username });
    res.status(201).json({ success: true, data: snapshot, message: 'Configuração capturada, criptografada e validada' });
  } catch (error) { next(error); }
});

router.get('/snapshots/:id/download', async (req, res, next) => {
  try {
    const snapshot = await prisma.deviceConfigBackup.findUnique({ where: { id: req.params.id } });
    if (!snapshot) return res.status(404).json({ success: false, error: 'Backup não encontrado' });
    const content = decryptSnapshot(snapshot);
    const extension = snapshot.deviceType === 'mikrotik' ? 'rsc' : 'cfg';
    const safeName = snapshot.deviceName.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '');
    const filename = `${safeName}-${snapshot.createdAt.toISOString().replace(/[:.]/g, '-')}.${extension}`;
    await logAudit({ ...requestIdentity(req), action: 'download', resource: 'device_backup', resourceId: snapshot.id, status: 'success', details: { deviceId: snapshot.deviceId, sha256: snapshot.sha256 } });
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(content);
  } catch (error) { next(error); }
});

router.get('/compare', async (req, res, next) => {
  try {
    const [before, after] = await Promise.all([
      prisma.deviceConfigBackup.findUnique({ where: { id: String(req.query.before || '') } }),
      prisma.deviceConfigBackup.findUnique({ where: { id: String(req.query.after || '') } }),
    ]);
    if (!before || !after || before.deviceId !== after.deviceId) return res.status(400).json({ success: false, error: 'Selecione dois backups válidos do mesmo equipamento' });
    const diff = compareConfigurations(decryptSnapshot(before), decryptSnapshot(after));
    res.json({ success: true, data: { before: { ...before, content: undefined }, after: { ...after, content: undefined }, diff } });
  } catch (error) { next(error); }
});

router.delete('/snapshots/:id', async (req, res, next) => {
  try {
    const snapshot = await prisma.deviceConfigBackup.delete({ where: { id: req.params.id } });
    await logAudit({ ...requestIdentity(req), action: 'delete', resource: 'device_backup', resourceId: snapshot.id, status: 'success', details: { deviceId: snapshot.deviceId, sha256: snapshot.sha256 } });
    res.json({ success: true, message: 'Backup removido' });
  } catch (error) { next(error); }
});

export default router;
