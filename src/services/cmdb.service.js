import crypto from 'node:crypto';
import prisma from '../database/client.js';

export const CMDB_CATEGORIES = ['network','server','virtual_machine','firewall','wireless','storage','ups','circuit','software','other'];
export const CMDB_STATUSES = ['active','spare','maintenance','retired','disposed'];
export const CMDB_CRITICALITIES = ['low','medium','high','critical'];
const text = (value, max = 255) => String(value || '').trim().slice(0, max) || null;
const date = value => { if (!value) return null; const parsed = value instanceof Date ? value : new Date(`${value}T12:00:00Z`); if (Number.isNaN(parsed.getTime())) throw Object.assign(new Error('Data inválida'), { statusCode: 400 }); return parsed; };

async function resolveRelations(input) {
  const device = input.deviceId ? await prisma.device.findUnique({ where: { id: String(input.deviceId) }, select: { id: true, tenantId: true, siteId: true, name: true, hostname: true, manufacturer: true, model: true, osVersion: true, type: true } }) : null;
  if (input.deviceId && !device) throw Object.assign(new Error('Equipamento monitorado não encontrado'), { statusCode: 400 });
  const tenantId = text(input.tenantId) || device?.tenantId || null;
  if (device?.tenantId && tenantId !== device.tenantId) throw Object.assign(new Error('O equipamento não pertence ao cliente selecionado'), { statusCode: 400 });
  if (tenantId && !await prisma.tenant.findFirst({ where: { id: tenantId, isActive: true }, select: { id: true } })) throw Object.assign(new Error('Cliente inválido ou inativo'), { statusCode: 400 });
  const siteId = text(input.siteId) || device?.siteId || null;
  if (siteId && !await prisma.tenantSite.findFirst({ where: { id: siteId, ...(tenantId && { tenantId }) }, select: { id: true } })) throw Object.assign(new Error('A unidade não pertence ao cliente selecionado'), { statusCode: 400 });
  return { device, tenantId, siteId };
}

export async function normalizeCmdbAsset(input, actor, current = null) {
  const merged = { ...(current || {}), ...input };
  const name = text(merged.name, 140);
  if (!name || name.length < 2) throw Object.assign(new Error('Informe um nome válido para o ativo'), { statusCode: 400 });
  const category = CMDB_CATEGORIES.includes(merged.category) ? merged.category : 'other';
  const status = CMDB_STATUSES.includes(merged.status) ? merged.status : 'active';
  const criticality = CMDB_CRITICALITIES.includes(merged.criticality) ? merged.criticality : 'medium';
  const { device, tenantId, siteId } = await resolveRelations(merged);
  const cost = merged.cost === '' || merged.cost == null ? null : Number(merged.cost);
  if (cost !== null && (!Number.isFinite(cost) || cost < 0)) throw Object.assign(new Error('Valor de aquisição inválido'), { statusCode: 400 });
  return {
    assetTag: text(merged.assetTag, 60) || current?.assetTag || `AT-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    name, category, status, criticality, tenantId, siteId, deviceId: device?.id || null,
    manufacturer: text(merged.manufacturer || device?.manufacturer, 100), model: text(merged.model || device?.model, 120), serialNumber: text(merged.serialNumber, 120),
    hostname: text(merged.hostname || device?.hostname, 255), managementIp: text(merged.managementIp, 255), location: text(merged.location, 180), rack: text(merged.rack, 60), rackUnit: text(merged.rackUnit, 30),
    purchaseDate: date(merged.purchaseDate), warrantyUntil: date(merged.warrantyUntil), supportUntil: date(merged.supportUntil), licenseUntil: date(merged.licenseUntil), cost, currency: text(merged.currency, 3)?.toUpperCase() || 'BRL',
    owner: text(merged.owner, 120), contact: text(merged.contact, 180), tags: text(merged.tags, 500), notes: text(merged.notes, 3000), updatedBy: actor,
  };
}

const relationshipAsset={select:{id:true,assetTag:true,name:true,category:true,status:true,criticality:true,tenantId:true}};
export const cmdbInclude = { tenant: { select: { id: true, name: true } }, site: { select: { id: true, name: true, city: true, state: true } }, device: { select: { id: true, name: true, type: true, hostname: true, isActive: true, osVersion: true } }, inventoryPolicy:true, inventorySnapshots:{select:{id:true,status:true,error:true,collectedBy:true,createdAt:true,manufacturer:true,model:true,serialNumber:true,hostname:true,osVersion:true,uptime:true},orderBy:{createdAt:'desc'},take:5}, interfaces:{orderBy:{name:'asc'}}, vlans:{orderBy:{vlanId:'asc'}}, relationshipsFrom:{include:{targetAsset:relationshipAsset},orderBy:{createdAt:'asc'}},relationshipsTo:{include:{sourceAsset:relationshipAsset},orderBy:{createdAt:'asc'}} };

export async function listCmdbAssets(query = {}) {
  const where = {};
  if (query.tenantId) where.tenantId = String(query.tenantId);
  if (CMDB_CATEGORIES.includes(query.category)) where.category = query.category;
  if (CMDB_STATUSES.includes(query.status)) where.status = query.status;
  if (CMDB_CRITICALITIES.includes(query.criticality)) where.criticality = query.criticality;
  const search = text(query.search, 120);
  if (search) where.OR = ['name','assetTag','serialNumber','hostname','managementIp','manufacturer','model','tags'].map(field => ({ [field]: { contains: search } }));
  return prisma.cmdbAsset.findMany({ where, include: cmdbInclude, orderBy: [{ status: 'asc' }, { name: 'asc' }], take: Math.min(Number(query.limit) || 500, 1000) });
}

export async function cmdbSummary(tenantId = null) {
  const scope = tenantId ? { tenantId } : {};
  const [total, active, maintenance, critical, linked, expiring] = await Promise.all([
    prisma.cmdbAsset.count({ where: scope }), prisma.cmdbAsset.count({ where: { ...scope, status: 'active' } }), prisma.cmdbAsset.count({ where: { ...scope, status: 'maintenance' } }),
    prisma.cmdbAsset.count({ where: { ...scope, criticality: 'critical', status: { notIn: ['retired','disposed'] } } }), prisma.cmdbAsset.count({ where: { ...scope, deviceId: { not: null } } }),
    prisma.cmdbAsset.count({ where: { ...scope, status: { notIn: ['retired','disposed'] }, OR: [{ warrantyUntil: { gte: new Date(), lte: new Date(Date.now() + 90 * 86400000) } }, { supportUntil: { gte: new Date(), lte: new Date(Date.now() + 90 * 86400000) } },{ licenseUntil: { gte: new Date(), lte: new Date(Date.now() + 90 * 86400000) } }] } }),
  ]);
  return { total, active, maintenance, critical, linked, expiring };
}
