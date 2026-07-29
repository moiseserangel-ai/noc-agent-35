import prisma from '../database/client.js';
import { encrypt, decrypt } from '../utils/crypto.js';
import logger from '../utils/logger.js';

export async function getAllDevices() {
  const devices = await prisma.device.findMany({
    orderBy: { createdAt: 'desc' },
  });
  return devices.map(d => ({ ...d, password: '••••••••' }));
}

export async function getDeviceById(id) {
  return prisma.device.findUnique({ where: { id } });
}

export async function getDeviceDecrypted(id) {
  let device = null;
  try {
    device = await prisma.device.findUnique({ where: { id } });
  } catch (err) {
    // Ignore invalid id format error
  }
  
  if (!device) {
    device = await findDeviceByNameOrHost(id);
  }
  
  if (!device) return null;
  return { ...device, password: decrypt(device.password) };
}

export async function findDeviceByNameOrHost(query) {
  const q = query.toLowerCase();
  const devices = await prisma.device.findMany({ where: { isActive: true } });
  return devices.find(
    d => d.name.toLowerCase().includes(q) || d.hostname.toLowerCase().includes(q)
  );
}

export async function findDeviceByZabbixHostId(hostId) {
  return prisma.device.findFirst({
    where: { zabbixHostId: hostId, isActive: true },
  });
}

export async function createDevice(data) {
  const encrypted = encrypt(data.password);
  const device = await prisma.device.create({
    data: { ...data, password: encrypted },
  });
  logger.info(`Device created: ${device.name} (${device.type})`);
  return { ...device, password: '••••••••' };
}

export async function updateDevice(id, data) {
  const updateData = { ...data };
  if (data.password) {
    updateData.password = encrypt(data.password);
  }
  const device = await prisma.device.update({
    where: { id },
    data: updateData,
  });
  logger.info(`Device updated: ${device.name}`);
  return { ...device, password: '••••••••' };
}

export async function deleteDevice(id) {
  const device = await prisma.device.delete({ where: { id } });
  logger.info(`Device deleted: ${device.name}`);
  return device;
}

export async function testDeviceConnection(id) {
  const device = await getDeviceDecrypted(id);
  if (!device) throw new Error('Device not found');
  if (device.type === 'unifi_controller') {
    const { unifiControllerQuery } = await import('../tools/unifi-controller.tool.js');
    const result = await unifiControllerQuery({ deviceId:id, operation:'status' });
    if (!result.success) throw new Error(result.output);
    return { success:true, message:`Conexão com UniFi Controller ${device.hostname} realizada com sucesso` };
  }

  const { Client } = await import('ssh2');
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const timeout = setTimeout(() => {
      conn.end();
      reject(new Error('Connection timeout (10s)'));
    }, 10000);

    conn.on('ready', () => {
      clearTimeout(timeout);
      conn.end();
      resolve({ success: true, message: `SSH connection to ${device.hostname} successful` });
    });

    conn.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`SSH connection failed: ${err.message}`));
    });

    conn.connect({
      host: device.hostname,
      port: device.port,
      username: device.username,
      password: device.password,
      readyTimeout: 10000,
    });
  });
}
