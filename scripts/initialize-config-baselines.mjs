import prisma from '../src/database/client.js';
import { promoteConfigurationBaseline } from '../src/services/config-drift.service.js';

let initialized = 0;
const devices = await prisma.device.findMany({
  where: { isActive: true, configBackups: { some: { status: 'success' } } },
  select: { id: true, name: true },
});

for (const device of devices) {
  const current = await prisma.deviceConfigBackup.findFirst({
    where: { deviceId: device.id, status: 'success', isBaseline: true },
    select: { id: true },
  });
  if (current) continue;

  const pending = await prisma.configDrift.findFirst({
    where: { deviceId: device.id, status: { in: ['open', 'acknowledged', 'verifying'] } },
    orderBy: { detectedAt: 'desc' },
    select: { beforeBackupId: true },
  });
  const accepted = pending ? null : await prisma.configDrift.findFirst({
    where: { deviceId: device.id, status: 'ignored' },
    orderBy: { resolvedAt: 'desc' },
    select: { afterBackupId: true },
  });
  const fallback = await prisma.deviceConfigBackup.findFirst({
    where: { deviceId: device.id, status: 'success' },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  const backupId = pending?.beforeBackupId || accepted?.afterBackupId || fallback?.id;
  if (!backupId) continue;
  await promoteConfigurationBaseline(backupId, 'system:baseline-migration');
  initialized++;
  console.log(`Baseline inicializado: ${device.name}`);
}

console.log(JSON.stringify({ devices: devices.length, initialized }));
await prisma.$disconnect();
