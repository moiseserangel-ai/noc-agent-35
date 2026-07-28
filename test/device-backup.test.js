import test from 'node:test';
import assert from 'node:assert/strict';
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
