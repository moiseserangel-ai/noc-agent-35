import { Router } from 'express';
import config from '../config/index.js';
import { authMiddleware, generateToken } from '../middleware/auth.middleware.js';
import prisma from '../database/client.js';
import { decrypt, encrypt } from '../utils/crypto.js';
import { ensureAdminUser, publicUser, verifyPassword, hashPassword } from '../services/user.service.js';
import { logAudit, requestIdentity } from '../services/audit.service.js';
import { generateTotpSecret, totpUri, verifyTotp } from '../services/totp.service.js';

const router = Router();

const attempts = new Map();
const sessionExpiry = () => new Date(Date.now() + 8 * 60 * 60_000);
async function createSession(user, req) {
  const session=await prisma.authSession.create({data:{userId:user.id,ipAddress:req.ip,userAgent:String(req.get('user-agent')||'').slice(0,300),expiresAt:sessionExpiry()}});
  return {session,token:generateToken(user,session.id)};
}
router.post('/login', async (req, res) => {
  const client = req.ip;
  const now = Date.now();
  const entry = attempts.get(client) || { count: 0, since: now };
  if (now - entry.since > 15 * 60_000) { entry.count = 0; entry.since = now; }
  if (entry.count >= 5) return res.status(429).json({ success: false, error: 'Muitas tentativas. Aguarde 15 minutos.' });
  const { password } = req.body;
  const username = String(req.body.username || 'admin').trim().toLowerCase();
  if (!password) return res.status(400).json({ success: false, error: 'Informe a senha' });
  const stored = await prisma.settings.findUnique({ where: { key: 'dashboard_password' } });
  const activePassword = stored?.value ? (stored.encrypted ? decrypt(stored.value) : stored.value) : config.dashboardPassword;
  await ensureAdminUser(activePassword);
  const user = await prisma.user.findUnique({ where: { username } });
  if(user?.lockedUntil && user.lockedUntil>new Date()) return res.status(423).json({success:false,error:`Usuário bloqueado até ${user.lockedUntil.toLocaleString('pt-BR')}`});
  if (!user?.isActive || !(await verifyPassword(password, user.passwordHash))) {
    entry.count += 1;
    attempts.set(client, entry);
    if(user){const failures=(user.failedLoginAttempts||0)+1;await prisma.user.update({where:{id:user.id},data:{failedLoginAttempts:failures,lockedUntil:failures>=5?new Date(Date.now()+15*60_000):null}});}
    await logAudit({ username, action: 'login', resource: 'auth', status: 'failure', ipAddress: req.ip, userAgent: req.get('user-agent'), details: { reason: 'invalid_credentials' } });
    return res.status(401).json({ success: false, error: 'Invalid password' });
  }
  if(user.twoFactorEnabled){
    const secret=decrypt(user.twoFactorSecret||'');
    if(!req.body.otp) return res.status(202).json({success:false,requiresTwoFactor:true,message:'Informe o código do aplicativo autenticador'});
    if(!verifyTotp(secret,req.body.otp)){await logAudit({username,userId:user.id,action:'login_2fa',resource:'auth',status:'failure',ipAddress:req.ip,userAgent:req.get('user-agent')});return res.status(401).json({success:false,error:'Código 2FA inválido',requiresTwoFactor:true});}
  }
  attempts.delete(client);
  const updated=await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(),failedLoginAttempts:0,lockedUntil:null } });
  const safe = publicUser(updated);
  const {token}=await createSession(updated,req);
  await logAudit({ userId: user.id, username: user.username, displayName: user.name, role: user.role, action: 'login', resource: 'auth', status: 'success', ipAddress: req.ip, userAgent: req.get('user-agent') });
  res.json({ success: true, token, user: safe });
});

router.post('/logout', authMiddleware, async (req, res) => {
  await prisma.authSession.update({where:{id:req.session.id},data:{revokedAt:new Date()}});
  await logAudit({ ...requestIdentity(req), action: 'logout', resource: 'auth', status: 'success' });
  res.json({ success: true });
});

router.get('/verify', authMiddleware, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
  if (!user?.isActive) return res.status(401).json({ success: false, error: 'Usuário inativo' });
  res.json({ success: true, user: publicUser(user) });
});

// Sliding session: an authenticated dashboard can renew its short-lived token
// without asking the administrator to log in again.
router.post('/refresh', authMiddleware, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
  if (!user?.isActive) return res.status(401).json({ success: false, error: 'Usuário inativo' });
  const expiresAt=sessionExpiry(); await prisma.authSession.update({where:{id:req.session.id},data:{expiresAt,lastSeenAt:new Date()}});
  res.json({ success: true, token: generateToken(user,req.session.id), user: publicUser(user) });
});

router.post('/change-password', authMiddleware, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
  if (!user || !(await verifyPassword(req.body.currentPassword, user.passwordHash))) return res.status(400).json({ success: false, error: 'Senha atual incorreta' });
  const updated=await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(req.body.newPassword), mustChangePassword: false,passwordChangedAt:new Date(),sessionVersion:{increment:1} } });
  await prisma.authSession.updateMany({where:{userId:user.id,revokedAt:null},data:{revokedAt:new Date()}});
  const {token}=await createSession(updated,req);
  await logAudit({ ...requestIdentity(req), action: 'change_password', resource: 'auth', status: 'success' });
  res.json({ success: true,token,user:publicUser(updated) });
});

router.post('/2fa/setup',authMiddleware,async(req,res)=>{
  const user=await prisma.user.findUnique({where:{id:req.user.sub}});if(!user||!(await verifyPassword(req.body.password,user.passwordHash)))return res.status(400).json({success:false,error:'Senha atual incorreta'});
  const secret=generateTotpSecret();await prisma.user.update({where:{id:user.id},data:{twoFactorSecret:encrypt(secret),twoFactorEnabled:false}});
  await logAudit({...requestIdentity(req),action:'2fa_setup',resource:'auth',status:'success'});
  res.json({success:true,data:{secret,uri:totpUri(secret,user.username)}});
});
router.post('/2fa/enable',authMiddleware,async(req,res)=>{
  const user=await prisma.user.findUnique({where:{id:req.user.sub}});const secret=decrypt(user?.twoFactorSecret||'');if(!secret||!verifyTotp(secret,req.body.code))return res.status(400).json({success:false,error:'Código 2FA inválido'});
  const updated=await prisma.user.update({where:{id:user.id},data:{twoFactorEnabled:true}});await logAudit({...requestIdentity(req),action:'2fa_enable',resource:'auth',status:'success'});res.json({success:true,user:publicUser(updated)});
});
router.post('/2fa/disable',authMiddleware,async(req,res)=>{
  const user=await prisma.user.findUnique({where:{id:req.user.sub}});if(!user||!(await verifyPassword(req.body.password,user.passwordHash))||!verifyTotp(decrypt(user.twoFactorSecret||''),req.body.code))return res.status(400).json({success:false,error:'Senha ou código 2FA inválido'});
  const updated=await prisma.user.update({where:{id:user.id},data:{twoFactorEnabled:false,twoFactorSecret:null}});await prisma.authSession.updateMany({where:{userId:user.id,id:{not:req.session.id}},data:{revokedAt:new Date()}});await logAudit({...requestIdentity(req),action:'2fa_disable',resource:'auth',status:'success'});res.json({success:true,user:publicUser(updated)});
});
router.get('/sessions',authMiddleware,async(req,res)=>{const sessions=await prisma.authSession.findMany({where:{userId:req.user.sub,revokedAt:null,expiresAt:{gt:new Date()}},orderBy:{lastSeenAt:'desc'}});res.json({success:true,data:sessions.map(x=>({...x,current:x.id===req.session.id}))});});
router.delete('/sessions/:id',authMiddleware,async(req,res)=>{const session=await prisma.authSession.findFirst({where:{id:req.params.id,userId:req.user.sub}});if(!session)return res.status(404).json({success:false,error:'Sessão não encontrada'});await prisma.authSession.update({where:{id:session.id},data:{revokedAt:new Date()}});await logAudit({...requestIdentity(req),action:'revoke_session',resource:'auth',resourceId:session.id,status:'success'});res.json({success:true,current:session.id===req.session.id});});

export default router;
