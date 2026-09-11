import { logAudit, requestIdentity } from '../services/audit.service.js';

const ACTIONS = { POST: 'create_or_execute', PUT: 'update', PATCH: 'update', DELETE: 'delete' };

export function auditMutation(req, res, next) {
  if (!ACTIONS[req.method]) return next();
  const startedAt = Date.now();
  res.once('finish', () => {
    const parts = req.baseUrl.split('/').filter(Boolean);
    const resource = parts.at(-1) || 'api';
    const resourceId = req.params?.id || req.params?.key || null;
    logAudit({
      ...requestIdentity(req), action: ACTIONS[req.method], resource, resourceId,
      status: res.statusCode < 400 ? 'success' : 'failure',
      details: { method: req.method, path: req.originalUrl.split('?')[0], statusCode: res.statusCode, durationMs: Date.now() - startedAt, fields: Object.keys(req.body || {}).filter(key => !/password|secret|token|key|psk/i.test(key)) },
    });
  });
  next();
}
