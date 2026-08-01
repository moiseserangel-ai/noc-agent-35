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
  return{roots,impacted,unmappedDeviceIds:[...selected].filter(id=>!roots.some(root=>root.deviceId===id)),summary:{mapped:roots.length,impacted:impacted.length,critical:impacted.filter(item=>item.asset.criticality==='critical'||item.relationship.critical).length,maxDepth:Math.max(0,...impacted.map(item=>item.depth))}};
}

export async function cmdbOperationalContext(deviceIds){
  const ids=[...new Set((deviceIds||[]).filter(Boolean).map(String))];
  if(!ids.length)return buildOperationalContext([],[],[]);
  const tenantIds=(await prisma.device.findMany({where:{id:{in:ids}},select:{tenantId:true}})).map(row=>row.tenantId).filter(Boolean);
  const scope=tenantIds.length?{OR:[{tenantId:null},{tenantId:{in:[...new Set(tenantIds)]}}]}:{};
  const[assets,relationships]=await Promise.all([prisma.cmdbAsset.findMany({where:scope,select:assetSelect}),prisma.cmdbRelationship.findMany({where:{sourceAsset:scope,targetAsset:scope}})]);
  return buildOperationalContext(ids,assets,relationships);
}
