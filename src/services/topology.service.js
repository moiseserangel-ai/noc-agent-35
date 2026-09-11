import prisma from '../database/client.js';

const OPEN_TASK_STATUSES = ['pending','diagnosing','awaiting_approval','executing','open','acknowledged','in_progress'];

export function topologyStatus(snapshot, tasks = []) {
  if (tasks.some(task => task.priority === 'critical')) return 'critical';
  if (tasks.some(task => ['high','medium'].includes(task.priority))) return 'warning';
  if (snapshot?.availability === 0) return 'offline';
  if (snapshot?.availability === 100) return 'online';
  return 'unknown';
}

export function defaultPosition(index, total) {
  const columns = Math.max(3, Math.ceil(Math.sqrt(Math.max(total, 1) * 1.6)));
  return { x: 110 + (index % columns) * 210, y: 100 + Math.floor(index / columns) * 160 };
}

export async function topologyDashboard(tenantId = null) {
  const devices = await prisma.device.findMany({
    where: { isActive: true, ...(tenantId && { tenantId }) },
    include: {
      topologyNode: true,
      tenant: { select: { id:true,name:true } },
      site: { select: { id: true, name: true } },
      capacitySnapshots: { orderBy: { collectedAt: 'desc' }, take: 1 },
      tasks: {
        where: { status: { in: OPEN_TASK_STATUSES } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, taskNumber: true, priority: true, status: true, originalMessage: true, createdAt: true },
      },
    },
    orderBy: [{ group: 'asc' }, { name: 'asc' }],
  });
  const deviceIds = devices.map(device => device.id);
  const rawLinks = deviceIds.length ? await prisma.topologyLink.findMany({
    where: { sourceDeviceId: { in: deviceIds }, targetDeviceId: { in: deviceIds } },
    include:{telemetry:{orderBy:{collectedAt:'desc'},take:1}},orderBy: { createdAt: 'asc' }
  }) : [];
  const nodes = devices.map((device, index) => {
    const snapshot = device.capacitySnapshots[0] || null;
    const position = device.topologyNode || defaultPosition(index, devices.length);
    return {
      id: device.id,
      name: device.name,
      hostname: device.hostname,
      type: device.type,
      manufacturer: device.manufacturer,
      model: device.model,
      osVersion: device.osVersion,
      group: device.group,
      site: device.site ? { id: device.site.id, name: device.site.name } : null,
      tenant: device.tenant ? { id:device.tenant.id,name:device.tenant.name } : null,
      status: topologyStatus(snapshot, device.tasks),
      position: { x: position.x, y: position.y, saved: Boolean(device.topologyNode) },
      metrics: snapshot ? {
        availability: snapshot.availability,
        cpu: snapshot.cpu,
        memory: snapshot.memory,
        storage: snapshot.storage,
        collectedAt: snapshot.collectedAt,
      } : null,
      tasks: device.tasks,
    };
  });
  const counts = Object.fromEntries(['online','warning','critical','offline','unknown'].map(status => [status, nodes.filter(node => node.status === status).length]));
  const byId=new Map(nodes.map(node=>[node.id,node]));
  const links=rawLinks.map(link=>{const sourceNode=byId.get(link.sourceDeviceId),targetNode=byId.get(link.targetDeviceId),states=[sourceNode?.status,targetNode?.status],latest=link.telemetry[0]||null,fresh=latest&&Date.now()-new Date(latest.collectedAt).getTime()<20*60_000,endpointStatus=states.some(value=>['offline','critical'].includes(value))?'critical':states.includes('warning')?'warning':states.every(value=>value==='online')?'online':'unknown',status=fresh&&latest.status!=='unknown'?latest.status:endpointStatus;return{...link,telemetry:latest,status,statusSource:fresh&&latest.status!=='unknown'?'zabbix':'endpoints',sourceNode:sourceNode?{id:sourceNode.id,name:sourceNode.name,status:sourceNode.status}:null,targetNode:targetNode?{id:targetNode.id,name:targetNode.name,status:targetNode.status}:null};});
  return {
    nodes,
    links,
    summary: { devices: nodes.length, links: links.length, ...counts },
    filters: {
      groups: [...new Set(nodes.map(node => node.group).filter(Boolean))].sort(),
      manufacturers: [...new Set(nodes.map(node => node.manufacturer).filter(Boolean))].sort(),
      sites: [...new Set(nodes.map(node => node.site?.name).filter(Boolean))].sort(),
      tenants: [...new Set(nodes.map(node => node.tenant?.name).filter(Boolean))].sort(),
    },
    updatedAt: new Date(),
  };
}

export async function saveTopologyPositions(items, username) {
  const positions = Array.isArray(items) ? items.slice(0, 500) : [];
  if (!positions.length) throw new Error('Nenhuma posição informada');
  const ids = [...new Set(positions.map(item => String(item.deviceId || '')))].filter(Boolean);
  const existing = await prisma.device.count({ where: { id: { in: ids }, isActive: true } });
  if (existing !== ids.length) throw new Error('Um ou mais equipamentos são inválidos');
  await prisma.$transaction(positions.map(item => prisma.topologyNode.upsert({
    where: { deviceId: String(item.deviceId) },
    update: { x: Math.min(Math.max(Number(item.x) || 0, 40), 4000), y: Math.min(Math.max(Number(item.y) || 0, 40), 2500), updatedBy: username },
    create: { deviceId: String(item.deviceId), x: Math.min(Math.max(Number(item.x) || 0, 40), 4000), y: Math.min(Math.max(Number(item.y) || 0, 40), 2500), updatedBy: username },
  })));
  return { saved: positions.length };
}

export async function createTopologyLink(input, username) {
  const sourceDeviceId = String(input.sourceDeviceId || '');
  const targetDeviceId = String(input.targetDeviceId || '');
  if (!sourceDeviceId || !targetDeviceId || sourceDeviceId === targetDeviceId) throw new Error('Selecione dois equipamentos diferentes');
  const count = await prisma.device.count({ where: { id: { in: [sourceDeviceId, targetDeviceId] }, isActive: true } });
  if (count !== 2) throw new Error('Equipamento de origem ou destino inválido');
  const [source, target] = [sourceDeviceId, targetDeviceId].sort(),sameDirection=source===sourceDeviceId;
  const linkType = ['ethernet','fiber','wireless','vpn','logical'].includes(input.linkType) ? input.linkType : 'ethernet';
  return prisma.topologyLink.create({
    data: {
      sourceDeviceId: source,
      targetDeviceId: target,
      label: String(input.label || '').trim().slice(0, 100) || null,
      sourceInterface:String((sameDirection?input.sourceInterface:input.targetInterface)||'').trim().slice(0,100)||null,
      targetInterface:String((sameDirection?input.targetInterface:input.sourceInterface)||'').trim().slice(0,100)||null,
      bandwidthMbps:Number.isInteger(Number(input.bandwidthMbps))&&Number(input.bandwidthMbps)>0?Math.min(Number(input.bandwidthMbps),1000000):null,
      linkType,
      source: 'manual',
      createdBy: username,
    },
  });
}
