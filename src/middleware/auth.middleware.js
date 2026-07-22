import jwt from 'jsonwebtoken';
import config from '../config/index.js';

export function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    req.user = decoded;
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

export function generateToken(user) {
  return jwt.sign({ sub: user.id, username: user.username, name: user.name, role: user.role, mustChangePassword: user.mustChangePassword }, config.jwtSecret, { expiresIn: '8h', issuer: 'noc-agent' });
}

export function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret, { issuer: 'noc-agent' });
}
