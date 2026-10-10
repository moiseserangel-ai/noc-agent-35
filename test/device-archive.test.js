import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const service = readFileSync(new URL('../src/services/device.service.js', import.meta.url), 'utf8');
const route = readFileSync(new URL('../src/routes/device.routes.js', import.meta.url), 'utf8');

test('a listagem operacional omite equipamentos inativos', () => {
  assert.match(service, /where:\s*\{\s*isActive:\s*true/);
});

test('a remoção arquiva o equipamento e desativa automações', () => {
  assert.match(service, /prisma\.device\.update\(\{\s*where:\s*\{ id \},\s*data:\s*\{ isActive:\s*false \}/);
  assert.match(service, /deviceBackupPolicy\.updateMany/);
  assert.match(service, /runbookSchedule\.updateMany/);
  assert.match(service, /statusService\.updateMany/);
  assert.doesNotMatch(service, /prisma\.device\.delete/);
  assert.match(route, /histórico foi preservado/);
});
