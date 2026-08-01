import prisma from '../database/client.js';

const assetSummary={select:{id:true,assetTag:true,name:true,criticality:true,tenantId:true,deviceId:true}};

export function topologySuggestionCandidate(link,assets,relationships=[]){
  const byDevice=new Map(assets.map(asset=>[asset.deviceId,asset])),first=byDevice.get(link.sourceDeviceId),second=byDevice.get(link.targetDeviceId);
  if(!first||!second||first.id===second.id||(first.tenantId&&second.tenantId&&first.tenantId!==second.tenantId))return null;
  const[source,target]=[first,second].sort((a,b)=>a.id.localeCompare(b.id));
  if(relationships.some(row=>row.type==='connected_to'&&((row.sourceAssetId===source.id&&row.targetAssetId===target.id)||(row.sourceAssetId===target.id&&row.targetAssetId===source.id))))return null;
  return{originKey:`topology-link:${link.id}`,sourceAssetId:source.id,targetAssetId:target.id,suggestedType:'connected_to',evidence:[link.sourceDevice?.name||link.sourceDeviceId,link.label||link.linkType,link.targetDevice?.name||link.targetDeviceId].join(' · '),protocol:link.source||'topology',confidence:link.source==='manual'?80:link.source==='cdp'?95:90};
}

export async function refreshCmdbSuggestions(){
  const[links,assets,relationships]=await Promise.all([
    prisma.topologyLink.findMany({include:{sourceDevice:{select:{name:true}},targetDevice:{select:{name:true}}}}),
    prisma.cmdbAsset.findMany({where:{deviceId:{not:null}},select:{id:true,deviceId:true,tenantId:true}}),
    prisma.cmdbRelationship.findMany({select:{sourceAssetId:true,targetAssetId:true,type:true}}),
  ]),activeOriginKeys=[];let created=0,skipped=0;
  for(const link of links){
    const candidate=topologySuggestionCandidate(link,assets,relationships);if(!candidate){skipped++;continue;}
    const current=await prisma.cmdbRelationshipSuggestion.findUnique({where:{originKey:candidate.originKey},select:{id:true}});
    activeOriginKeys.push(candidate.originKey);
    await prisma.cmdbRelationshipSuggestion.upsert({where:{originKey:candidate.originKey},update:candidate,create:candidate});
    if(!current)created++;
  }
  await prisma.cmdbRelationshipSuggestion.updateMany({where:{status:'suggested',originKey:{startsWith:'topology-link:',...(activeOriginKeys.length&&{notIn:activeOriginKeys})}},data:{status:'stale'}});
  return{created,skipped,examined:links.length};
}

export async function listCmdbSuggestions(){return prisma.cmdbRelationshipSuggestion.findMany({where:{status:'suggested'},include:{sourceAsset:assetSummary,targetAsset:assetSummary},orderBy:[{confidence:'desc'},{createdAt:'desc'}],take:500});}

export async function approveCmdbSuggestion(id,input,username){
  const suggestion=await prisma.cmdbRelationshipSuggestion.findUnique({where:{id},include:{sourceAsset:true,targetAsset:true}});
  if(!suggestion||suggestion.status!=='suggested')throw Object.assign(new Error('Sugestão não encontrada ou já revisada'),{statusCode:409});
  const type=['connected_to','depends_on','hosted_on','powered_by','protected_by','provides_service_to','contains','licensed_by'].includes(input.type)?input.type:suggestion.suggestedType;
  const sourceAssetId=input.reverse===true?suggestion.targetAssetId:suggestion.sourceAssetId,targetAssetId=input.reverse===true?suggestion.sourceAssetId:suggestion.targetAssetId;
  return prisma.$transaction(async tx=>{const relationship=await tx.cmdbRelationship.create({data:{sourceAssetId,targetAssetId,type,label:String(input.label||suggestion.evidence||'').slice(0,120)||null,critical:input.critical===true,createdBy:username}});await tx.cmdbRelationshipSuggestion.update({where:{id},data:{status:'approved',reviewedBy:username,reviewedAt:new Date(),relationshipId:relationship.id,suggestedType:type}});return relationship;});
}

export async function ignoreCmdbSuggestion(id,username){const row=await prisma.cmdbRelationshipSuggestion.findFirst({where:{id,status:'suggested'}});if(!row)throw Object.assign(new Error('Sugestão não encontrada ou já revisada'),{statusCode:409});return prisma.cmdbRelationshipSuggestion.update({where:{id},data:{status:'ignored',reviewedBy:username,reviewedAt:new Date()}});}
