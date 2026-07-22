import prisma from '../database/client.js';
import logger from '../utils/logger.js';

export async function logAudit(entry) {
  try {
    return await prisma.auditLog.create({ data: {
      userId: entry.userId || null,
      username: String(entry.username || 'system').slice(0, 80),
      displayName: entry.displayName ? String(entry.displayName).slice(0, 120) : null,
      role: entry.role ? String(entry.role).slice(0, 30) : null,
      action: String(entry.action || 'unknown').slice(0, 80),
      resource: String(entry.resource || 'system').slice(0, 80),
      resourceId: entry.resourceId ? String(entry.resourceId).slice(0, 120) : null,
      status: entry.status === 'failure' ? 'failure' : 'success',
      ipAddress: entry.ipAddress ? String(entry.ipAddress).slice(0, 80) : null,
      userAgent: entry.userAgent ? String(entry.userAgent).slice(0, 300) : null,
      details: entry.details ? JSON.stringify(entry.details).slice(0, 4000) : null,
    }});
  } catch (error) {
    logger.error(`Audit write failed: ${error.message}`);
    return null;
  }
}

export function requestIdentity(req) {
  return { userId: req.user?.sub, username: req.user?.username || 'anonymous', displayName: req.user?.name, role: req.user?.role, ipAddress: req.ip, userAgent: req.get?.('user-agent') };
}
