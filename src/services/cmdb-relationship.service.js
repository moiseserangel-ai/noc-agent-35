import prisma from '../database/client.js';

export const CMDB_RELATIONSHIP_TYPES=['depends_on','connected_to','hosted_on','powered_by','protected_by','provides_service_to','contains','licensed_by'];
const assetSelect={id:true,assetTag:true,name:true,category:true,status:true,criticality:true,tenantId:true,manufacturer:true,model:true};
const bad=message=>Object.assign(new Error(message),{statusCode:400});

export async function validateCmdbRelationship(input){
  const sourceAssetId=String(input.sourceAssetId||''),targetAssetId=String(input.targetAssetId||''),type=String(input.type||'');
  if(!sourceAssetId||!targetAssetId||sourceAssetId===targetAssetId)throw bad('Selecione dois ativos diferentes');
  if(!CMDB_RELATIONSHIP_TYPES.includes(type))throw bad('Tipo de relacionamento inválido');
  const assets=await prisma.cmdbAsset.findMany({where:{id:{in:[sourceAssetId,targetAssetId]}},select:assetSelect});
  if(assets.length!==2)throw bad('Ativo de origem ou destino não encontrado');
  const [source,target]=[assets.find(x=>x.id===sourceAssetId),assets.find(x=>x.id===targetAssetId)];
  if(source.tenantId&&target.tenantId&&source.tenantId!==target.tenantId)throw bad('Não é permitido relacionar ativos de clientes diferentes');
  return{source,target,data:{sourceAssetId,targetAssetId,type,label:String(input.label||'').trim().slice(0,120)||null,notes:String(input.notes||'').trim().slice(0,1000)||null,critical:input.critical===true}};
}

export function relationshipImpactEdges(relationships){
  const edges=[];
  for(const row of relationships){
    if(['depends_on','powered_by','protected_by','licensed_by','hosted_on'].includes(row.type))edges.push([row.targetAssetId,row.sourceAssetId,row]);
    else if(['provides_service_to','contains'].includes(row.type))edges.push([row.sourceAssetId,row.targetAssetId,row]);
    else if(row.type==='connected_to'){edges.push([row.sourceAssetId,row.targetAssetId,row],[row.targetAssetId,row.sourceAssetId,row]);}
  }
  return edges;
}

export function calculateImpact(rootAssetId,assets,relationships,maxDepth=6){
  const assetMap=new Map(assets.map(asset=>[asset.id,asset])),edges=relationshipImpactEdges(relationships),visited=new Set([rootAssetId]),queue=[{id:rootAssetId,depth:0,path:[rootAssetId]}],impacted=[];
  while(queue.length){const current=queue.shift();if(current.depth>=maxDepth)continue;for(const[from,to,relation]of edges){if(from!==current.id||visited.has(to))continue;visited.add(to);const path=[...current.path,to],entry={asset:assetMap.get(to),depth:current.depth+1,path,relationship:{id:relation.id,type:relation.type,critical:relation.critical}};if(entry.asset)impacted.push(entry);queue.push({id:to,depth:entry.depth,path});}}
  return impacted.sort((a,b)=>a.depth-b.depth||Number(b.relationship.critical)-Number(a.relationship.critical)||a.asset.name.localeCompare(b.asset.name));
}

export async function cmdbImpact(assetId){const root=await prisma.cmdbAsset.findUnique({where:{id:assetId},select:assetSelect});if(!root)throw Object.assign(new Error('Ativo não encontrado'),{statusCode:404});const[assets,relationships]=await Promise.all([prisma.cmdbAsset.findMany({select:assetSelect}),prisma.cmdbRelationship.findMany()]);const impacted=calculateImpact(root.id,assets,relationships);return{root,impacted,summary:{total:impacted.length,direct:impacted.filter(x=>x.depth===1).length,critical:impacted.filter(x=>x.asset.criticality==='critical'||x.relationship.critical).length,maxDepth:Math.max(0,...impacted.map(x=>x.depth))}};}
