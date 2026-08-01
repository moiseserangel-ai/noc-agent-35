import prisma from '../database/client.js';

export const CMDB_TRACKED_FIELDS=['assetTag','name','category','status','criticality','tenantId','siteId','deviceId','manufacturer','model','serialNumber','hostname','managementIp','location','rack','rackUnit','purchaseDate','warrantyUntil','supportUntil','cost','currency','owner','contact','tags','notes'];
const value=input=>input instanceof Date?input.toISOString():input===undefined?null:input;

export function diffCmdbValues(before={},after={},fields=CMDB_TRACKED_FIELDS){
  const changes=[];
  for(const field of fields){const oldValue=value(before[field]),newValue=value(after[field]);if(JSON.stringify(oldValue)!==JSON.stringify(newValue))changes.push({field,before:oldValue,after:newValue});}
  return changes;
}

export async function recordCmdbHistory({assetId,eventType,source='manual',actor='system',summary,changes=[],metadata=null},db=prisma){
  return db.cmdbHistory.create({data:{assetId,eventType,source,actor:String(actor).slice(0,100),summary:String(summary).slice(0,500),changes:changes.length?JSON.stringify(changes).slice(0,12000):null,metadata:metadata?JSON.stringify(metadata).slice(0,4000):null}});
}

export async function listCmdbHistory(assetId,limit=100){
  const rows=await prisma.cmdbHistory.findMany({where:{assetId},orderBy:{createdAt:'desc'},take:Math.min(Math.max(Number(limit)||100,1),500)});
  return rows.map(row=>({...row,changes:row.changes?JSON.parse(row.changes):[],metadata:row.metadata?JSON.parse(row.metadata):null}));
}
