import prisma from '../database/client.js';
import logger from '../utils/logger.js';
import crypto from 'node:crypto';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');

export async function verifyAuditChain() {
  const rows = await prisma.auditLog.findMany({ orderBy:[{createdAt:'asc'},{id:'asc'}] });
  let previousHash = null;
  let protectedRecords = 0;
  const invalid = [];
  for (const row of rows) {
    if (!row.recordHash) continue;
    const payload = JSON.stringify({
      previousHash:row.previousHash || null, id:row.id, username:row.username,
      action:row.action, resource:row.resource, resourceId:row.resourceId || null,
      status:row.status, details:row.details || null, createdAt:row.createdAt.toISOString(),
    });
    if (row.previousHash !== previousHash || hash(payload) !== row.recordHash) invalid.push(row.id);
    previousHash = row.recordHash;
    protectedRecords++;
  }
  return { valid:invalid.length===0, records:rows.length, protectedRecords, legacyRecords:rows.length-protectedRecords, invalid };
}

export async function logAudit(entry) {
  try {
    const previous = await prisma.auditLog.findFirst({where:{recordHash:{not:null}},orderBy:[{createdAt:'desc'},{id:'desc'}]});
    const id = crypto.randomUUID();
    const createdAt = new Date();
    const data = {
      id,
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
      previousHash: previous?.recordHash || null,
      createdAt,
    };
    data.recordHash = hash(JSON.stringify({
      previousHash:data.previousHash, id, username:data.username, action:data.action,
      resource:data.resource, resourceId:data.resourceId, status:data.status,
      details:data.details, createdAt:createdAt.toISOString(),
    }));
    return await prisma.auditLog.create({ data });
  } catch (error) {
    logger.error(`Audit write failed: ${error.message}`);
    return null;
  }
}

export function requestIdentity(req) {
  return { userId: req.user?.sub, username: req.user?.username || 'anonymous', displayName: req.user?.name, role: req.user?.role, ipAddress: req.ip, userAgent: req.get?.('user-agent') };
}
