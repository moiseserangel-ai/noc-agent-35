import prisma from '../database/client.js';

export const SERVICE_STATES=['operational','degraded','partial_outage','major_outage','maintenance'];
export const INCIDENT_STATES=['investigating','identified','monitoring','resolved','scheduled'];
const terminal=['resolved','completed','validated','closed','cancelled'];
const weight={operational:0,degraded:1,maintenance:1,partial_outage:2,major_outage:3};

const taskState=tasks=>tasks.some(task=>task.priority==='critical')?'major_outage':tasks.some(task=>task.priority==='high')?'partial_outage':tasks.length?'degraded':'operational';
export function deriveServiceStatus(service,{tasks=[],incidents=[],now=new Date()}={}){
  if(!service.enabled)return'operational';
  if(!service.automatic)return SERVICE_STATES.includes(service.manualStatus)?service.manualStatus:'operational';
  const maintenance=incidents.some(item=>item.status==='scheduled'&&item.scheduledAt<=now&&item.scheduledEndAt>now);
  if(maintenance)return'maintenance';
  const incidentState=incidents.filter(item=>item.status!=='resolved').reduce((state,item)=>weight[item.severity]>weight[state]?item.severity:state,'operational');
  const automatic=taskState(tasks.filter(task=>!terminal.includes(task.status)));
  return weight[incidentState]>=weight[automatic]?incidentState:automatic;
}

export async function syncStatusServices(now=new Date()){
  const services=await prisma.statusService.findMany({where:{enabled:true},include:{incidents:{where:{OR:[{status:{not:'resolved'}},{scheduledEndAt:{gte:now}}]}},device:true}});
  const results=[];
  for(const service of services){
    const tasks=service.deviceId?await prisma.task.findMany({where:{deviceId:service.deviceId,status:{notIn:terminal}},select:{priority:true,status:true}}):[];
    const status=deriveServiceStatus(service,{tasks,incidents:service.incidents,now});
    if(status!==service.currentStatus){
      await prisma.$transaction([prisma.statusService.update({where:{id:service.id},data:{currentStatus:status}}),prisma.statusServiceEvent.create({data:{serviceId:service.id,status,startedAt:now}})]);
    }
    results.push({...service,currentStatus:status});
  }
  return results;
}

export function availabilityFromEvents(events,now=new Date(),days=30){
  const start=new Date(now.getTime()-days*86400_000),ordered=[...events].sort((a,b)=>new Date(a.startedAt)-new Date(b.startedAt));
  let down=0;
  for(let index=0;index<ordered.length;index++){
    const from=new Date(Math.max(start,new Date(ordered[index].startedAt))),to=new Date(Math.min(now,index+1<ordered.length?new Date(ordered[index+1].startedAt):now));
    if(to>from&&['partial_outage','major_outage'].includes(ordered[index].status))down+=to-from;
  }
  return Math.max(0,Math.min(100,(1-down/(days*86400_000))*100));
}

export async function getPublicStatusPage(tenantSlug=null){
  await syncStatusServices();
  const tenant=tenantSlug?await prisma.tenant.findFirst({where:{slug:tenantSlug,isActive:true}}):null;
  if(tenantSlug&&!tenant)throw Object.assign(new Error('Status Page não encontrada'),{statusCode:404});
  const scope={tenantId:tenant?.id||null};
  const [services,incidents,settings]=await Promise.all([
    prisma.statusService.findMany({where:{enabled:true,...scope},orderBy:[{sortOrder:'asc'},{name:'asc'}],include:{events:{where:{startedAt:{gte:new Date(Date.now()-30*86400_000)}},orderBy:{startedAt:'asc'}}}}),
    prisma.statusIncident.findMany({where:{service:scope,OR:[{status:{not:'resolved'}},{resolvedAt:{gte:new Date(Date.now()-30*86400_000)}}]},orderBy:{publishedAt:'desc'},include:{service:{select:{name:true}},updates:{orderBy:{createdAt:'desc'}}}}),
    prisma.settings.findMany({where:{key:{in:['status_page_title','status_page_description']}}}),
  ]);
  const config=Object.fromEntries(settings.map(item=>[item.key,item.value]));
  const overall=services.reduce((state,item)=>weight[item.currentStatus]>weight[state]?item.currentStatus:state,'operational');
  return{title:tenant?.portalTitle||config.status_page_title||'Status dos Serviços',description:tenant?.portalDescription||config.status_page_description||'Disponibilidade e comunicação de incidentes',primaryColor:tenant?.primaryColor||null,tenant:tenant?{name:tenant.name,slug:tenant.slug}:null,overall,updatedAt:new Date(),services:services.map(({events,...item})=>({id:item.id,name:item.name,description:item.description,status:item.currentStatus,availability30d:Number(availabilityFromEvents(events).toFixed(3))})),incidents:incidents.map(item=>({id:item.id,title:item.title,message:item.message,severity:item.severity,status:item.status,publishedAt:item.publishedAt,resolvedAt:item.resolvedAt,scheduledAt:item.scheduledAt,scheduledEndAt:item.scheduledEndAt,service:item.service.name,updates:item.updates.map(update=>({id:update.id,status:update.status,message:update.message,createdAt:update.createdAt}))}))};
}
