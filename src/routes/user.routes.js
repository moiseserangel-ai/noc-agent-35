import { Router } from 'express';
import prisma from '../database/client.js';
import { createUser, hashPassword, publicUser } from '../services/user.service.js';
import { ALL_ROLES, TENANT_ROLES, validateScopedRole } from '../security/roles.js';

const router = Router();
router.get('/', async (req, res, next) => { try { res.json({ success: true, data: (await prisma.user.findMany({where:req.user.tenantId?{tenantId:req.user.tenantId}:{}, orderBy: { name: 'asc' } })).map(publicUser) }); } catch (e) { next(e); } });
router.post('/', async (req, res, next) => { try {const data={...req.body};if(req.user.tenantId){data.tenantId=req.user.tenantId;if(!TENANT_ROLES.includes(data.role))throw new Error('Selecione um perfil de empresa');}validateScopedRole(data.role,data.tenantId||null);res.status(201).json({ success: true, data: publicUser(await createUser(data)) }); } catch (e) { e.statusCode = 400; next(e); } });
router.put('/:id', async (req, res, next) => { try {
  const target=await prisma.user.findFirst({where:{id:req.params.id,...(req.user.tenantId&&{tenantId:req.user.tenantId})}});if(!target)return res.status(404).json({success:false,error:'Usuário não encontrado'});
  const data = {};
  if (req.body.name !== undefined) data.name = String(req.body.name).trim();
  if (req.body.role !== undefined) {if(!ALL_ROLES.includes(req.body.role))throw new Error('Perfil inválido');data.role=req.body.role;}
  if (typeof req.body.isActive === 'boolean') data.isActive = req.body.isActive;
  if (req.body.tenantId !== undefined&&!req.user.tenantId) data.tenantId = req.body.tenantId || null;
  const effectiveTenant=req.user.tenantId||(req.body.tenantId!==undefined?data.tenantId:target.tenantId)||null,effectiveRole=data.role||target.role;validateScopedRole(effectiveRole,effectiveTenant);
  const securityChanged = Boolean(req.body.password || req.body.role || req.body.tenantId!==undefined || typeof req.body.isActive === 'boolean');
  if (req.body.password) Object.assign(data, { passwordHash: await hashPassword(req.body.password), mustChangePassword: true, passwordChangedAt: new Date() });
  if (securityChanged) data.sessionVersion = { increment: 1 };
  if (req.params.id === req.user.sub && (data.isActive === false || (data.role && !['admin','tenant_admin'].includes(data.role)))) return res.status(400).json({ success: false, error: 'Você não pode remover seu próprio acesso administrativo' });
  const updated=await prisma.user.update({ where: { id: req.params.id }, data });
  if(securityChanged) await prisma.authSession.updateMany({where:{userId:req.params.id,revokedAt:null},data:{revokedAt:new Date()}});
  res.json({ success: true, data: publicUser(updated) });
} catch (e) { e.statusCode = 400; next(e); } });
router.delete('/:id', async (req, res, next) => { try {
  if (req.params.id === req.user.sub) return res.status(400).json({ success: false, error: 'Você não pode excluir seu próprio usuário' });
  if(req.user.tenantId&&!await prisma.user.findFirst({where:{id:req.params.id,tenantId:req.user.tenantId},select:{id:true}}))return res.status(404).json({success:false,error:'Usuário não encontrado'});
  await prisma.user.delete({ where: { id: req.params.id } }); res.json({ success: true });
} catch (e) { next(e); } });
export default router;
