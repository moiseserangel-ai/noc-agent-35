import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compareConfigurations, nextDeviceBackupAt } from '../src/services/device-backup.service.js';

test('calcula o próximo backup diário sem repetir o horário vencido', () => {
  const before = nextDeviceBackupAt({ frequency: 'daily', hour: 2 }, new Date(2026, 6, 28, 1, 30));
  const after = nextDeviceBackupAt({ frequency: 'daily', hour: 2 }, new Date(2026, 6, 28, 3, 0));
  assert.deepEqual([before.getDate(), before.getHours()], [28, 2]);
  assert.deepEqual([after.getDate(), after.getHours()], [29, 2]);
});

test('calcula o próximo backup semanal pelo dia configurado', () => {
  const next = nextDeviceBackupAt({ frequency: 'weekly', hour: 4, weekday: 5 }, new Date(2026, 6, 28, 12, 0));
  assert.deepEqual([next.getDay(), next.getDate(), next.getHours()], [5, 31, 4]);
});

test('compara versões sem revelar conteúdo fora das diferenças', () => {
  const diff = compareConfigurations('/ip address add address=10.0.0.1/24\n/ip route add gateway=1.1.1.1', '/ip address add address=10.0.0.1/24\n/ip route add gateway=2.2.2.2');
  assert.deepEqual(diff.added, ['/ip route add gateway=2.2.2.2']);
  assert.deepEqual(diff.removed, ['/ip route add gateway=1.1.1.1']);
  assert.equal(diff.unchangedCount, 1);
});

test('ignora o cabeçalho dinâmico de data do export RouterOS',()=>{
  const before='# aug/02/2026 13:57:44 by RouterOS 6.49.13\n/ip dns set servers=1.1.1.1';
  const after='# aug/02/2026 13:57:57 by RouterOS 6.49.13\n/ip dns set servers=1.1.1.1';
  const diff=compareConfigurations(before,after);
  assert.equal(diff.addedCount,0);
  assert.equal(diff.removedCount,0);
});

test('ignora o cabeçalho ISO dos exports RouterOS 7',()=>{
  const before='# 2026-09-12 02:00:12 by RouterOS 7.18.2\n/ip dns set servers=1.1.1.1';
  const after='# 2026-09-19 02:00:59 by RouterOS 7.18.2\n/ip dns set servers=1.1.1.1';
  const diff=compareConfigurations(before,after);
  assert.equal(diff.addedCount,0);
  assert.equal(diff.removedCount,0);
});

test('schema registra drift com snapshots, evidência e Task',()=>{
  const schema=fs.readFileSync(new URL('../prisma/schema.prisma',import.meta.url),'utf8');
  const service=fs.readFileSync(new URL('../src/services/config-drift.service.js',import.meta.url),'utf8');
  const routes=fs.readFileSync(new URL('../src/routes/device-backup.routes.js',import.meta.url),'utf8');
  assert.match(schema,/model ConfigDrift/);
  assert.match(schema,/afterBackupId\s+String\s+@unique/);
  assert.match(schema,/evidence\s+String/);
  assert.match(schema,/taskId\s+String\?/);
  assert.match(schema,/isBaseline\s+Boolean\s+@default\(false\)/);
  assert.match(schema,/status\s+String\s+@default\("open"\).*verifying/);
  assert.match(service,/status:\{in:\['open','acknowledged','verifying'\]\}/);
  assert.match(service,/Configuração aceita como novo baseline/);
  assert.match(routes,/runDeviceBackup\(row\.deviceId,\{type:'manual'/);
  assert.match(routes,/baseline ativo não pode ser removido/);
});
