import prisma from '../database/client.js';
import { decrypt } from '../utils/crypto.js';
import logger from '../utils/logger.js';
import { logAudit } from './audit.service.js';

let collecting=false;
const number=value=>{const parsed=Number(value);return Number.isFinite(parsed)?parsed:null;};
const round=value=>value===null?null:Math.round(value*100)/100;

export async function capacityConfig(){
  const rows=await prisma.settings.findMany({where:{key:{in:['zabbix_url','zabbix_api_token']}}});
  const values=Object.fromEntries(rows.map(row=>[row.key,row.encrypted?decrypt(row.value):row.value]));
  const base=String(values.zabbix_url||'').trim().replace(/\/+$/,'');
  return {url:base?`${base}${base.endsWith('api_jsonrpc.php')?'':'/api_jsonrpc.php'}`:'',token:String(values.zabbix_api_token||'').trim()};
}

export async function zabbixCall(config,method,params){
  const body={jsonrpc:'2.0',method,params,id:Date.now()};
  const response=await fetch(config.url,{method:'POST',headers:{'content-type':'application/json-rpc','authorization':`Bearer ${config.token}`},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data.error)throw new Error(data.error?.data||data.error?.message||`Zabbix HTTP ${response.status}`);
  return data.result||[];
}

export function capacityForecast(samples,threshold=85){
  const points=samples.filter(item=>Number.isFinite(item.value)).sort((a,b)=>new Date(a.at)-new Date(b.at));
  if(points.length<3)return {trend:'insufficient',slopePerDay:0,daysToThreshold:null};
  const start=new Date(points[0].at).getTime();
  const xs=points.map(item=>(new Date(item.at).getTime()-start)/86400000);
  const ys=points.map(item=>item.value);
  const xMean=xs.reduce((a,b)=>a+b,0)/xs.length,yMean=ys.reduce((a,b)=>a+b,0)/ys.length;
  const denominator=xs.reduce((sum,x)=>sum+(x-xMean)**2,0);
  const slope=denominator?xs.reduce((sum,x,index)=>sum+(x-xMean)*(ys[index]-yMean),0)/denominator:0;
  const current=ys.at(-1);
  const days=slope>0&&current<threshold?(threshold-current)/slope:null;
  return {trend:slope>.25?'rising':slope<-.25?'falling':'stable',slopePerDay:round(slope),daysToThreshold:days!==null&&days>=0?round(days):null};
}

function extractMetrics(items,host){
  const active=items.filter(item=>item.status==='0'&&item.lastvalue!==''&&item.lastvalue!==null);
  const find=predicate=>active.find(predicate);
  const cpuItem=find(item=>item.key_.startsWith('system.cpu.util')&&/idle/.test(item.key_))||find(item=>item.key_.startsWith('system.cpu.util'));
  let cpu=number(cpuItem?.lastvalue);
  if(cpu!==null&&/idle/.test(cpuItem?.key_||''))cpu=100-cpu;
  const memoryUtil=find(item=>item.key_.startsWith('vm.memory.util'));
  const memoryUsed=find(item=>item.key_.includes('vm.memory.size[pused]'));
  let memory=number(memoryUtil?.lastvalue)??number(memoryUsed?.lastvalue);
  if(memory===null){
    const total=number(find(item=>item.key_.includes('vm.memory.size[total]'))?.lastvalue);
    const available=number(find(item=>/vm.memory.size\[(available|free)\]/.test(item.key_))?.lastvalue);
    if(total&&available!==null)memory=(1-available/total)*100;
  }
  const disks=active.filter(item=>(item.key_.startsWith('vfs.fs.size[')&&item.key_.includes(',pused]'))||item.key_.startsWith('vfs.fs.pused[')).map(item=>number(item.lastvalue)).filter(value=>value!==null);
  const storage=disks.length?Math.max(...disks):null;
  const sumKeys=prefix=>active.filter(item=>item.key_.startsWith(prefix)).reduce((sum,item)=>sum+(number(item.lastvalue)||0),0);
  const trafficIn=sumKeys('net.if.in[')||null,trafficOut=sumKeys('net.if.out[')||null;
  const uptime=number(find(item=>item.key_.startsWith('system.uptime'))?.lastvalue);
  const ping=number(find(item=>item.key_==='icmpping')?.lastvalue);
  const interfaces=host.interfaces||[];
  const interfaceAvailable=interfaces.some(item=>String(item.main)==='1'&&String(item.available)==='1');
  const interfaceUnavailable=interfaces.some(item=>String(item.main)==='1'&&String(item.available)==='2');
  const availability=ping!==null?(ping>0?100:0):interfaceAvailable?100:interfaceUnavailable?0:null;
  return {availability:round(availability),cpu:round(cpu),memory:round(memory),storage:round(storage),trafficIn:round(trafficIn),trafficOut:round(trafficOut),uptime:round(uptime),metrics:JSON.stringify({items:active.length,hostStatus:host.status,interfaces:interfaces.map(item=>({type:item.type,available:item.available,error:item.error||''}))})};
}

export async function collectCapacity({username='system'}={}){
  if(collecting)throw Object.assign(new Error('Já existe uma coleta de capacidade em andamento'),{statusCode:409});
  collecting=true;
  try{
    const config=await capacityConfig();
    if(!config.url||!config.token)throw Object.assign(new Error('Configure URL e token de API do Zabbix'),{statusCode:400});
    const devices=await prisma.device.findMany({where:{isActive:true,zabbixHostId:{not:null}},select:{id:true,name:true,zabbixHostId:true}});
    if(!devices.length)return {collected:0,devices:0,message:'Nenhum equipamento possui Zabbix Host ID'};
    const hostIds=[...new Set(devices.map(item=>item.zabbixHostId))];
    const [hosts,items]=await Promise.all([
      zabbixCall(config,'host.get',{hostids:hostIds,output:['hostid','host','name','status'],selectInterfaces:['interfaceid','main','type','available','error']}),
      zabbixCall(config,'item.get',{hostids:hostIds,output:['itemid','hostid','name','key_','lastvalue','lastclock','units','status'],monitored:true,searchByAny:true,search:{key_:['system.cpu.util','vm.memory','vfs.fs','net.if.in','net.if.out','system.uptime','icmpping']}}),
    ]);
    const hostMap=new Map(hosts.map(host=>[String(host.hostid),host]));
    const itemMap=new Map();
    items.forEach(item=>{const list=itemMap.get(String(item.hostid))||[];list.push(item);itemMap.set(String(item.hostid),list);});
    let collected=0;
    for(const device of devices){
      const host=hostMap.get(String(device.zabbixHostId));
      if(!host)continue;
      const values=extractMetrics(itemMap.get(String(device.zabbixHostId))||[],host);
      await prisma.capacitySnapshot.create({data:{deviceId:device.id,zabbixHostId:String(device.zabbixHostId),...values}});
      collected++;
    }
    await prisma.capacitySnapshot.deleteMany({where:{collectedAt:{lt:new Date(Date.now()-90*86400000)}}});
    await logAudit({username,displayName:username==='system'?'Coletor de capacidade':username,role:username==='system'?'system':'admin',action:'collect',resource:'capacity',status:'success',details:{devices:devices.length,collected,items:items.length}});
    return {collected,devices:devices.length,items:items.length};
  }finally{collecting=false;}
}

export async function capacityDashboard(days=30,tenantId=null){
  const config=await capacityConfig();
  const since=new Date(Date.now()-Math.min(Math.max(Number(days)||30,1),90)*86400000);
  const devices=await prisma.device.findMany({where:{isActive:true,zabbixHostId:{not:null},...(tenantId&&{tenantId})},select:{id:true,name:true,hostname:true,type:true,group:true,zabbixHostId:true,capacitySnapshots:{where:{collectedAt:{gte:since}},orderBy:{collectedAt:'asc'}}},orderBy:{name:'asc'}});
  const rows=devices.map(device=>{
    const history=device.capacitySnapshots,latest=history.at(-1)||null;
    const forecast=metric=>capacityForecast(history.map(item=>({at:item.collectedAt,value:item[metric]})));
    const available=history.filter(item=>item.availability!==null);
    return {...device,capacitySnapshots:undefined,latest,availability30d:available.length?round(available.reduce((sum,item)=>sum+item.availability,0)/available.length):null,forecast:{cpu:forecast('cpu'),memory:forecast('memory'),storage:forecast('storage')},history:history.map(item=>({at:item.collectedAt,availability:item.availability,cpu:item.cpu,memory:item.memory,storage:item.storage,trafficIn:item.trafficIn,trafficOut:item.trafficOut}))};
  });
  const current=rows.map(row=>row.latest).filter(Boolean);
  const risks=rows.filter(row=>['cpu','memory','storage'].some(metric=>(row.latest?.[metric]||0)>=80||((row.forecast[metric].daysToThreshold??999)<=30)));
  return {configured:Boolean(config.url&&config.token),lastCollectedAt:current.map(item=>item.collectedAt).sort((a,b)=>new Date(b)-new Date(a))[0]||null,summary:{devices:rows.length,online:current.filter(item=>item.availability===100).length,offline:current.filter(item=>item.availability===0).length,risks:risks.length,averageAvailability:current.length?round(current.reduce((sum,item)=>sum+(item.availability||0),0)/current.length):null},rows,risks:risks.map(row=>({id:row.id,name:row.name,hostname:row.hostname,latest:row.latest,forecast:row.forecast}))};
}

export async function runCapacityScheduler(){
  const config=await capacityConfig();
  if(!config.url||!config.token)return;
  await collectCapacity({username:'system'}).catch(error=>logger.error(`Capacity collection: ${error.message}`));
}
