import net from 'node:net';
import prisma from '../database/client.js';
import logger from '../utils/logger.js';
import { logAudit } from './audit.service.js';

const running = new Set();
export const DEFAULT_DISCOVERY_PORTS = [22,80,443,8291,8728,8729];
const ALLOWED_PORTS = new Set([22,23,80,443,161,443,830,8291,8728,8729,8080,8443]);

const ipToInt = ip => {
  const parts=String(ip).split('.').map(Number);
  if(parts.length!==4||parts.some(value=>!Number.isInteger(value)||value<0||value>255))throw Object.assign(new Error('Endereço IPv4 inválido'),{statusCode:400});
  return parts.reduce((result,value)=>(result*256+value)>>>0,0);
};
const intToIp = value => [24,16,8,0].map(shift=>(value>>>shift)&255).join('.');
const isPrivate = value => {
  const a=(value>>>24)&255,b=(value>>>16)&255;
  return a===10||(a===172&&b>=16&&b<=31)||(a===192&&b===168);
};

export function expandPrivateCidr(value) {
  const match=String(value||'').trim().match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/);
  if(!match)throw Object.assign(new Error('Informe a faixa no formato CIDR, por exemplo 192.168.10.0/24'),{statusCode:400});
  const ip=ipToInt(match[1]),prefix=Number(match[2]);
  if(prefix<24||prefix>32)throw Object.assign(new Error('A descoberta aceita faixas entre /24 e /32, limitadas a 256 endereços'),{statusCode:400});
  if(!isPrivate(ip))throw Object.assign(new Error('Somente redes privadas RFC1918 podem ser descobertas'),{statusCode:400});
  const mask=prefix===0?0:(0xffffffff<<(32-prefix))>>>0;
  const network=(ip&mask)>>>0;
  const count=2**(32-prefix);
  const first=count>2?network+1:network;
  const last=count>2?network+count-2:network+count-1;
  return Array.from({length:last-first+1},(_,index)=>intToIp((first+index)>>>0));
}

export function normalizeDiscoveryPorts(input) {
  const ports=(Array.isArray(input)?input:String(input||'').split(',')).map(Number).filter(value=>Number.isInteger(value)&&ALLOWED_PORTS.has(value));
  const unique=[...new Set(ports.length?ports:DEFAULT_DISCOVERY_PORTS)];
  if(unique.length>12)throw Object.assign(new Error('Selecione no máximo 12 portas permitidas'),{statusCode:400});
  return unique.sort((a,b)=>a-b);
}

function tcpProbe(host,port,timeoutMs) {
  return new Promise(resolve=>{
    const started=Date.now();
    const socket=new net.Socket();
    let settled=false,banner='';
    const finish=open=>{
      if(settled)return;settled=true;socket.destroy();
      resolve({open,latencyMs:open?Date.now()-started:null,banner:banner.replace(/[^\x20-\x7E]/g,'').trim().slice(0,240)});
    };
    socket.setTimeout(timeoutMs);
    socket.once('error',()=>finish(false));
    socket.once('timeout',()=>finish(false));
    socket.on('data',chunk=>{banner+=chunk.toString('utf8');if(banner.length>=240)finish(true);});
    socket.connect(port,host,()=>{
      if(port===80)socket.write(`HEAD / HTTP/1.0\r\nHost: ${host}\r\n\r\n`);
      if(port!==22&&port!==80)setTimeout(()=>finish(true),40);
      else setTimeout(()=>finish(true),Math.min(timeoutMs,300));
    });
  });
}

export function identifyDiscoveredHost(openPorts,banner='') {
  const ports=new Set(openPorts);
  const text=String(banner).toLowerCase();
  if(ports.has(8291)||ports.has(8728)||ports.has(8729)||text.includes('routeros'))return {detectedType:'mikrotik',manufacturer:'MikroTik',confidence:ports.has(8291)?95:85};
  if(/huawei|vrp/.test(text))return {detectedType:'huawei_vrp',manufacturer:'Huawei',confidence:90};
  if(ports.has(22))return {detectedType:'linux',manufacturer:null,confidence:45};
  return {detectedType:null,manufacturer:null,confidence:20};
}

async function scanHost(ip,ports,timeoutMs) {
  const probes=await Promise.all(ports.map(async port=>({port,...await tcpProbe(ip,port,timeoutMs)})));
  const open=probes.filter(item=>item.open);
  if(!open.length)return null;
  const sshBanner=open.find(item=>item.port===22)?.banner||null;
  return {ipAddress:ip,latencyMs:Math.min(...open.map(item=>item.latencyMs||timeoutMs)),openPorts:open.map(item=>item.port),sshBanner,...identifyDiscoveredHost(open.map(item=>item.port),sshBanner)};
}

export async function runDiscoveryJob(jobId) {
  if(running.has(jobId))return;
  running.add(jobId);
  try{
    const job=await prisma.discoveryJob.findUnique({where:{id:jobId}});
    if(!job||job.status==='cancelled')return;
    const addresses=expandPrivateCidr(job.cidr);
    const ports=normalizeDiscoveryPorts(job.ports);
    await prisma.discoveryJob.update({where:{id:job.id},data:{status:'running',startedAt:new Date(),error:null}});
    let scanned=0,found=0;
    for(let offset=0;offset<addresses.length;offset+=24){
      const state=await prisma.discoveryJob.findUnique({where:{id:job.id},select:{status:true}});
      if(state?.status==='cancelled')break;
      const results=await Promise.all(addresses.slice(offset,offset+24).map(ip=>scanHost(ip,ports,job.timeoutMs)));
      for(const host of results.filter(Boolean)){
        const existing=await prisma.device.findFirst({where:{hostname:host.ipAddress},select:{id:true}});
        await prisma.discoveryHost.upsert({
          where:{jobId_ipAddress:{jobId:job.id,ipAddress:host.ipAddress}},
          update:{openPorts:host.openPorts.join(','),latencyMs:host.latencyMs,sshBanner:host.sshBanner,detectedType:host.detectedType,manufacturer:host.manufacturer,confidence:host.confidence,state:existing?'known':'new',existingDeviceId:existing?.id||null},
          create:{jobId:job.id,ipAddress:host.ipAddress,openPorts:host.openPorts.join(','),latencyMs:host.latencyMs,sshBanner:host.sshBanner,detectedType:host.detectedType,manufacturer:host.manufacturer,confidence:host.confidence,state:existing?'known':'new',existingDeviceId:existing?.id||null},
        });
        found++;
      }
      scanned=Math.min(offset+24,addresses.length);
      await prisma.discoveryJob.update({where:{id:job.id},data:{scanned,found}});
    }
    const current=await prisma.discoveryJob.findUnique({where:{id:job.id},select:{status:true}});
    if(current?.status!=='cancelled')await prisma.discoveryJob.update({where:{id:job.id},data:{status:'completed',scanned:addresses.length,found,completedAt:new Date()}});
    await logAudit({username:job.createdBy,displayName:job.createdBy,role:'admin',action:'scan',resource:'network_discovery',resourceId:job.id,status:'success',details:{cidr:job.cidr,ports,scanned,found,cancelled:current?.status==='cancelled'}});
  }catch(error){
    await prisma.discoveryJob.update({where:{id:jobId},data:{status:'failed',error:error.message.slice(0,2000),completedAt:new Date()}}).catch(()=>{});
    logger.error(`Discovery ${jobId}: ${error.message}`);
  }finally{running.delete(jobId);}
}

export function startDiscoveryJob(jobId) {
  setImmediate(()=>runDiscoveryJob(jobId));
}
