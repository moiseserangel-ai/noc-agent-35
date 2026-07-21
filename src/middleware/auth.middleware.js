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

export function generateToken() {
  return jwt.sign({ role: 'admin' }, config.jwtSecret, { expiresIn: '8h', issuer: 'noc-agent' });
}

export function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret, { issuer: 'noc-agent' });
}
