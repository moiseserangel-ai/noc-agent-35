import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
const devices = fs.readFileSync(new URL('../src/routes/device.routes.js', import.meta.url), 'utf8');
const tasks = fs.readFileSync(new URL('../src/routes/task.routes.js', import.meta.url), 'utf8');
const reports = fs.readFileSync(new URL('../src/routes/report.routes.js', import.meta.url), 'utf8');

test('somente APIs explicitamente isoladas ficam abertas a usuários de cliente', () => {
  const protectedMounts = [...server.matchAll(/app\.use\('\/api\/([^']+)',\s*authMiddleware,([^;\n]+)\);/g)];
  const tenantAccessible = protectedMounts.filter(match => !match[2].includes('globalOnly')).map(match => match[1]).sort();
  assert.deepEqual(tenantAccessible, ['devices', 'reports', 'tasks']);
});

test('as três APIs de cliente aplicam tenantId nas coleções e recursos individuais', () => {
  assert.match(devices, /getAllDevices\(req\.user\.tenantId\)/);
  assert.match(devices, /getDeviceById\(id,req\.user\.tenantId\)/);
  assert.match(tasks, /tenantId:req\.user\.tenantId/);
  assert.match(tasks, /where:\{id,tenantId:req\.user\.tenantId\}/);
  assert.match(reports, /buildIncidentReport\(req\.query,req\.user\.tenantId\)/);
  assert.match(reports, /req\.user\.tenantId \|\| String\(req\.query\.tenantId/);
});
