import prisma from '../database/client.js';
import { calculateImpact } from './cmdb-relationship.service.js';

const assetSelect={id:true,assetTag:true,name:true,category:true,status:true,criticality:true,tenantId:true,deviceId:true,manufacturer:true,model:true,managementIp:true,hostname:true};

export function buildOperationalContext(deviceIds,assets,relationships){
  const selected=new Set((deviceIds||[]).map(String)),roots=assets.filter(asset=>asset.deviceId&&selected.has(asset.deviceId)),impactedMap=new Map();
  for(const root of roots)for(const item of calculateImpact(root.id,assets,relationships))if(!roots.some(row=>row.id===item.asset.id)){
    const current=impactedMap.get(item.asset.id);
    if(!current||item.depth<current.depth)impactedMap.set(item.asset.id,{...item,rootAssetId:root.id,rootAssetName:root.name});
  }
  const impacted=[...impactedMap.values()].sort((a,b)=>a.depth-b.depth||a.asset.name.localeCompare(b.asset.name));
  return{roots,impacted,services:[],unmappedDeviceIds:[...selected].filter(id=>!roots.some(root=>root.deviceId===id)),summary:{mapped:roots.length,impacted:impacted.length,critical:impacted.filter(item=>item.asset.criticality==='critical'||item.relationship.critical).length,maxDepth:Math.max(0,...impacted.map(item=>item.depth)),services:0,criticalServices:0,clients:0}};
}

export async function cmdbOperationalContext(deviceIds){
  const ids=[...new Set((deviceIds||[]).filter(Boolean).map(String))];
  if(!ids.length)return buildOperationalContext([],[],[]);
  const tenantIds=(await prisma.device.findMany({where:{id:{in:ids}},select:{tenantId:true}})).map(row=>row.tenantId).filter(Boolean);
  const scope=tenantIds.length?{OR:[{tenantId:null},{tenantId:{in:[...new Set(tenantIds)]}}]}:{};
  const[assets,relationships]=await Promise.all([prisma.cmdbAsset.findMany({where:scope,select:assetSelect}),prisma.cmdbRelationship.findMany({where:{sourceAsset:scope,targetAsset:scope}})]),context=buildOperationalContext(ids,assets,relationships),affectedIds=[...new Set([...context.roots.map(row=>row.id),...context.impacted.map(row=>row.asset.id)])];
  if(affectedIds.length){context.services=await prisma.businessService.findMany({where:{status:'active',assets:{some:{assetId:{in:affectedIds}}}},include:{tenant:{select:{id:true,name:true}},assets:{where:{assetId:{in:affectedIds}},include:{asset:{select:{id:true,assetTag:true,name:true,status:true}}}}},orderBy:[{criticality:'desc'},{name:'asc'}]});}
  context.summary.services=context.services.length;context.summary.criticalServices=context.services.filter(row=>row.criticality==='critical').length;context.summary.clients=new Set(context.services.map(row=>row.tenantId).filter(Boolean)).size;
  return context;
}

const rank={low:0,medium:1,high:2,critical:3};
export function elevatedPriority(current='medium',services=[]){const servicePriority=services.reduce((value,row)=>rank[row.criticality]>rank[value]?row.criticality:value,'low');return rank[servicePriority]>rank[current]?servicePriority:current;}
export function businessServiceSlaMinutes(services=[]){const values=services.map(row=>Number(row.slaMinutes)).filter(value=>Number.isInteger(value)&&value>0);return values.length?Math.min(...values):null;}

export function formatBusinessImpact(context){if(!context?.services?.length)return'';const lines=context.services.slice(0,8).map(row=>`- ${row.name} (${row.criticality})${row.tenant?.name?` — ${row.tenant.name}`:''}`);return[`Impacto de negócio: ${context.services.length} serviço(s), ${context.summary.clients} cliente(s)`,...lines].join('\n');}
