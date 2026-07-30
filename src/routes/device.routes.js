import { Router } from 'express';
import * as deviceService from '../services/device.service.js';
import { isSupportedDeviceType, publicVendorPlugins, supportedDeviceTypes } from '../vendors/registry.js';
import { getDeviceChanges } from '../services/device-change.service.js';
import prisma from '../database/client.js';

const router = Router();
router.param('id',async(req,res,next,id)=>{try{if(!req.user.tenantId)return next();const device=await deviceService.getDeviceById(id,req.user.tenantId);return device?next():res.status(404).json({success:false,error:'Equipamento não encontrado'});}catch(error){next(error);}});

router.get('/', async (req, res, next) => {
  try {
    const devices = await deviceService.getAllDevices(req.user.tenantId);
    res.json({ success: true, data: devices });
  } catch (err) { next(err); }
});

router.get('/catalog/types', (req, res) => res.json({ success: true, data: publicVendorPlugins() }));

router.get('/:id/changes', async (req, res, next) => {
  try { res.json({ success: true, data: await getDeviceChanges(req.params.id, req.query.limit) }); } catch (error) { next(error); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const device = await deviceService.getDeviceById(req.params.id,req.user.tenantId);
    if (!device) return res.status(404).json({ success: false, error: 'Device not found' });
    res.json({ success: true, data: { ...device, password: '••••••••' } });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const { name, hostname, port, type, username, password, group, zabbixHostId, notes, manufacturer, platform, model, osVersion, capabilities,tenantId,siteId } = req.body;
    if (!name || !hostname || !type || !username || !password) {
      return res.status(400).json({ success: false, error: 'Missing required fields: name, hostname, type, username, password' });
    }
    if (!isSupportedDeviceType(type)) {
      return res.status(400).json({ success: false, error: `Tipo deve ser um destes: ${supportedDeviceTypes.join(', ')}` });
    }
    const assignedTenant=req.user.tenantId||tenantId||null;
    if(siteId){const site=await prisma.tenantSite.findFirst({where:{id:siteId,...(assignedTenant&&{tenantId:assignedTenant})}});if(!site)return res.status(400).json({success:false,error:'Unidade não pertence ao cliente selecionado'});}
    const device = await deviceService.createDevice({
      name, hostname, port: port || 22, type, username, password,
      group: group || null, zabbixHostId: zabbixHostId || null, notes: notes || null,
      manufacturer: manufacturer || null, platform: platform || null, model: model || null,
      osVersion: osVersion || null, capabilities: capabilities || null,tenantId:assignedTenant,siteId:siteId||null,
    });
    res.status(201).json({ success: true, data: device });
  } catch (err) { next(err); }
});

router.put('/:id', async (req, res, next) => {
  try {
    if (req.body.type && !isSupportedDeviceType(req.body.type)) return res.status(400).json({ success: false, error: `Tipo deve ser um destes: ${supportedDeviceTypes.join(', ')}` });
    const input={...req.body};if(req.user.tenantId)input.tenantId=req.user.tenantId;
    if(input.siteId){const site=await prisma.tenantSite.findFirst({where:{id:input.siteId,...(input.tenantId&&{tenantId:input.tenantId})}});if(!site)return res.status(400).json({success:false,error:'Unidade não pertence ao cliente selecionado'});}
    const device = await deviceService.updateDevice(req.params.id, input);
    if(input.tenantId!==undefined)await prisma.task.updateMany({where:{deviceId:device.id},data:{tenantId:input.tenantId||null}});
    res.json({ success: true, data: device });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await deviceService.deleteDevice(req.params.id);
    res.json({ success: true, message: 'Device deleted' });
  } catch (err) { next(err); }
});

router.post('/:id/test', async (req, res, next) => {
  try {
    const result = await deviceService.testDeviceConnection(req.params.id);
    res.json({ success: true, data: result });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

export default router;
