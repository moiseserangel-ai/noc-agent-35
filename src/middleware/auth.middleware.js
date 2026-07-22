import jwt from 'jsonwebtoken';
import config from '../config/index.js';
import prisma from '../database/client.js';

export async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    if (!decoded.sub || !decoded.jti) throw new Error('Legacy token');
    const [user, session] = await Promise.all([prisma.user.findUnique({where:{id:decoded.sub}}),prisma.authSession.findUnique({where:{id:decoded.jti}})]);
    if(!user?.isActive||!session||session.userId!==user.id||session.revokedAt||session.expiresAt<=new Date()||decoded.sessionVersion!==user.sessionVersion) throw new Error('Session invalid');
    req.user = { ...decoded, name:user.name, username:user.username, role:user.role, mustChangePassword:user.mustChangePassword };
    req.session=session;
    if(Date.now()-new Date(session.lastSeenAt).getTime()>300000) prisma.authSession.update({where:{id:session.id},data:{lastSeenAt:new Date()}}).catch(()=>{});
    next();
  } catch {
    return res.status(401).json({ success: false, error: 'Invalid token' });
  }
}

export function requireRoles(...roles) {
  return (req, res, next) => roles.includes(req.user?.role)
    ? next()
    : res.status(403).json({ success: false, error: 'Você não tem permissão para esta operação' });
}

export function readOnlyForViewer(req, res, next) {
  if (req.user?.role === 'viewer' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return res.status(403).json({ success: false, error: 'Perfil de visualização não pode realizar alterações' });
  }
  next();
}

export function generateToken(user, sessionId) {
  return jwt.sign({ sub: user.id, username: user.username, name: user.name, role: user.role, mustChangePassword: user.mustChangePassword, sessionVersion:user.sessionVersion }, config.jwtSecret, { expiresIn: '8h', issuer: 'noc-agent', jwtid:sessionId });
}

export function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret, { issuer: 'noc-agent' });
}
