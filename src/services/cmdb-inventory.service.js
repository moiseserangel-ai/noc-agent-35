import prisma from '../database/client.js';
import logger from '../utils/logger.js';
import { sshMikrotikExec } from '../tools/ssh-mikrotik.tool.js';
import { sshHuaweiVrpExec } from '../tools/ssh-huawei-vrp.tool.js';
import { sshCiscoIosExec } from '../tools/ssh-cisco-ios.tool.js';
import { sshJuniperJunosExec } from '../tools/ssh-juniper-junos.tool.js';
import { sshFortiGateExec } from '../tools/ssh-fortigate-fortios.tool.js';
import { sshEdgeOsExec } from '../tools/ssh-ubiquiti-edgeos.tool.js';
import { sshDatacomDmosExec, sshNokiaSrosExec } from '../tools/ssh-profiled-network.tool.js';
import { sshLinuxExec } from '../tools/ssh-linux.tool.js';
import { logAudit } from './audit.service.js';
import { diffCmdbValues, recordCmdbHistory } from './cmdb-history.service.js';

const running=new Set();
export const INVENTORY_TYPES=['mikrotik','huawei_vrp','cisco_ios','juniper_junos','fortigate_fortios','ubiquiti_edgeos','datacom_dmos','nokia_sros','linux'];
const commands={
  mikrotik:'/system resource print without-paging\n/system routerboard print without-paging\n/system identity print without-paging',
  huawei_vrp:'display version\ndisplay device',cisco_ios:'show version\nshow inventory',juniper_junos:'show version\nshow chassis hardware',
  fortigate_fortios:'get system status\ndiagnose hardware deviceinfo',ubiquiti_edgeos:'show version',datacom_dmos:'show version\nshow inventory',nokia_sros:'show version\nshow chassis',
  linux:'hostname\nuname -a\ncat /etc/os-release\ncat /sys/class/dmi/id/product_name\ncat /sys/class/dmi/id/product_serial',
};
const executors={mikrotik:sshMikrotikExec,huawei_vrp:sshHuaweiVrpExec,cisco_ios:sshCiscoIosExec,juniper_junos:sshJuniperJunosExec,fortigate_fortios:sshFortiGateExec,ubiquiti_edgeos:sshEdgeOsExec,datacom_dmos:sshDatacomDmosExec,nokia_sros:sshNokiaSrosExec,linux:sshLinuxExec};
const first=(source,patterns)=>{for(const pattern of patterns){const match=source.match(pattern);if(match?.[1])return match[1].trim().replace(/^"|"$/g,'').slice(0,180);}return null;};

export function parseInventoryOutput(type,output,device={}){
  const source=String(output||'').replace(/\r/g,'');
  const base={manufacturer:device.manufacturer||null,model:device.model||null,serialNumber:null,hostname:device.name||device.hostname||null,osVersion:device.osVersion||null,uptime:null};
  if(type==='mikrotik')Object.assign(base,{manufacturer:'MikroTik',model:first(source,[/^\s*model:\s*([^\n]+)/mi,/^\s*board-name:\s*([^\n]+)/mi]),serialNumber:first(source,[/^\s*serial-number:\s*([^\n]+)/mi,/^\s*system-id:\s*([^\n]+)/mi]),hostname:first(source,[/^\s*name:\s*([^\n]+)/mi]),osVersion:first(source,[/^\s*version:\s*([^\s\n]+)/mi]),uptime:first(source,[/^\s*uptime:\s*([^\n]+)/mi])});
  else if(type==='huawei_vrp')Object.assign(base,{manufacturer:'Huawei',model:first(source,[/HUAWEI\s+((?:NE|AR|CE|ME|ATN|S)\d[A-Z0-9-]*)\s+(?:Routing|uptime|version)/i,/\b((?:NetEngine|NE|AR|CE|ME|ATN|S)\d[A-Z0-9-]*)\s+uptime/i]),serialNumber:first(source,[/(?:ESN|Serial Number|BarCode)\s*[:=]\s*(\S+)/i]),osVersion:first(source,[/VRP.*?Version\s+([^\s,)]+)/i,/Version\s*:\s*([^\n]+)/i]),uptime:first(source,[/uptime is\s+([^\n]+)/i])});
  else if(type==='cisco_ios')Object.assign(base,{manufacturer:'Cisco',model:first(source,[/Cisco\s+(\S+)\s+\([^)]*\)\s+processor/i,/NAME:\s*"Chassis"[^\n]*PID:\s*([^,\s]+)/i]),serialNumber:first(source,[/Processor board ID\s+(\S+)/i,/SN:\s*([^,\s]+)/i]),hostname:first(source,[/^([^\s#]+) uptime is /mi]),osVersion:first(source,[/Cisco IOS(?: XE)? Software[^\n]*Version\s+([^,\s]+)/i]),uptime:first(source,[/uptime is\s+([^\n]+)/i])});
  else if(type==='juniper_junos')Object.assign(base,{manufacturer:'Juniper',model:first(source,[/^Model:\s*(\S+)/mi,/Chassis\s+(\S+)\s+/mi]),serialNumber:first(source,[/^Chassis\s+(\S+)\s+/mi]),hostname:first(source,[/^Hostname:\s*(\S+)/mi]),osVersion:first(source,[/^Junos:\s*(\S+)/mi])});
  else if(type==='fortigate_fortios')Object.assign(base,{manufacturer:'Fortinet',model:first(source,[/^Version:\s*FortiGate-([^\s]+)\s+/mi]),serialNumber:first(source,[/^Serial-Number:\s*(\S+)/mi]),hostname:first(source,[/^Hostname:\s*(\S+)/mi]),osVersion:first(source,[/^Version:.*?\s(v[^,\s]+)/mi]),uptime:first(source,[/^System time:\s*(.+)$/mi])});
  else if(type==='ubiquiti_edgeos')Object.assign(base,{manufacturer:'Ubiquiti',model:first(source,[/^HW model:\s*(.+)$/mi]),serialNumber:first(source,[/^HW S\/N:\s*(\S+)/mi]),hostname:first(source,[/^Hostname:\s*(\S+)/mi]),osVersion:first(source,[/^Version:\s*(\S+)/mi]),uptime:first(source,[/^Uptime:\s*(.+)$/mi])});
  else if(type==='linux')Object.assign(base,{manufacturer:device.manufacturer||'Linux',model:first(source,[/^product_name\s*[:=]\s*(.+)$/mi,/\n([^\n]+)\n[^\n]*product_serial/im]),serialNumber:first(source,[/^product_serial\s*[:=]\s*(.+)$/mi]),osVersion:first(source,[/^PRETTY_NAME=(.+)$/mi]),hostname:first(source,[/^\$ hostname\s*\n([^\n]+)/mi])});
  else Object.assign(base,{serialNumber:first(source,[/(?:Serial Number|Serial|S\/N)\s*[:=]\s*(\S+)/i]),model:first(source,[/(?:Model|Platform|Chassis)\s*[:=]\s*([^\n]+)/i]),osVersion:first(source,[/(?:Software Version|Version)\s*[:=]\s*([^\n]+)/i]),uptime:first(source,[/uptime(?: is)?\s*[:=]?\s*([^\n]+)/i])});
  for(const key of Object.keys(base))if(base[key])base[key]=String(base[key]).trim().slice(0,180);
  return {...base,rawExcerpt:source.slice(0,24000)};
}

export function nextInventoryAt(policy,from=new Date()){
  const next=new Date(from);next.setMinutes(0,0,0);next.setHours(Math.max(0,Math.min(23,Number(policy.hour)||0)));
  if(policy.frequency==='daily'){if(next<=from)next.setDate(next.getDate()+1);return next;}
  const weekday=Math.max(0,Math.min(6,Number(policy.weekday)||0));let days=(weekday-next.getDay()+7)%7;if(days===0&&next<=from)days=7;next.setDate(next.getDate()+days);return next;
}

export const isUsableMikrotikInventoryOutput=output=>/\bversion:\s*\S+/i.test(String(output||''))&&/\bname:\s*[^\r\n]+/i.test(String(output||''));

async function executeInventory(device){const exec=executors[device.type];if(!exec)throw Object.assign(new Error('Fabricante ainda não possui coleta automática de inventário'),{statusCode:400});const result=await exec({deviceId:device.id,command:commands[device.type]});const partialChr=device.type==='mikrotik'&&isUsableMikrotikInventoryOutput(result.output);if(!result.success&&!partialChr)throw Object.assign(new Error(result.output||'Falha na consulta de inventário'),{statusCode:502});return parseInventoryOutput(device.type,result.output,device);}

export async function collectCmdbInventory(assetId,{username='system',type='manual'}={}){
  if(running.has(assetId))throw Object.assign(new Error('Já existe uma coleta em andamento para este ativo'),{statusCode:409});running.add(assetId);let asset;
  try{
    asset=await prisma.cmdbAsset.findUnique({where:{id:assetId},include:{device:true,inventoryPolicy:true}});if(!asset)throw Object.assign(new Error('Ativo não encontrado'),{statusCode:404});if(!asset.device?.isActive)throw Object.assign(new Error('Vincule um equipamento monitorado e ativo antes da coleta'),{statusCode:400});if(!INVENTORY_TYPES.includes(asset.device.type))throw Object.assign(new Error('Tipo sem suporte à coleta automática'),{statusCode:400});
    const data=await executeInventory(asset.device),now=new Date();
    const snapshot=await prisma.cmdbInventorySnapshot.create({data:{assetId:asset.id,deviceId:asset.device.id,status:'success',manufacturer:data.manufacturer,model:data.model,serialNumber:data.serialNumber,hostname:data.hostname,osVersion:data.osVersion,uptime:data.uptime,inventoryData:JSON.stringify(data),collectedBy:username}});
    // O inventário técnico é a fonte atual para os campos exibidos nas telas de
    // equipamentos, topologia e vulnerabilidades. Sem esta sincronização o
    // CMDB recebia o snapshot novo, mas o Device continuava com a versão antiga.
    const deviceSync={};
    for(const field of ['manufacturer','model','hostname','osVersion']){
      if(data[field]) deviceSync[field]=data[field];
    }
    if(Object.keys(deviceSync).length) await prisma.device.update({where:{id:asset.device.id},data:deviceSync});
    let previousInventory={};try{previousInventory=asset.inventoryData?JSON.parse(asset.inventoryData):{};}catch{}
    const reconciled={manufacturer:data.manufacturer||asset.manufacturer,model:data.model||asset.model,serialNumber:data.serialNumber||asset.serialNumber,hostname:data.hostname||asset.hostname},changes=diffCmdbValues({...asset,osVersion:previousInventory.osVersion},{...reconciled,osVersion:data.osVersion},['manufacturer','model','serialNumber','hostname','osVersion']);
    await prisma.cmdbAsset.update({where:{id:asset.id},data:{...reconciled,lastInventoryAt:now,lastInventoryStatus:'success',lastInventoryError:null,inventoryData:JSON.stringify(data),updatedBy:username}});
    await recordCmdbHistory({assetId:asset.id,eventType:changes.length?'inventory_reconciled':'inventory_verified',source:type==='automatic'?'automatic_inventory':'manual_inventory',actor:username,summary:changes.length?`${changes.length} diferença(s) reconciliada(s) pela coleta técnica`:'Inventário verificado sem alterações técnicas',changes,metadata:{snapshotId:snapshot.id,deviceId:asset.device.id}});
    if(type==='automatic'&&asset.inventoryPolicy)await prisma.cmdbInventoryPolicy.update({where:{assetId:asset.id},data:{lastRunAt:now,lastStatus:'success',lastError:null,nextRunAt:nextInventoryAt(asset.inventoryPolicy,new Date(now.getTime()+60000))}});
    await logAudit({username,displayName:username==='system'?'Coletor CMDB':username,role:username==='system'?'system':'admin',action:'collect',resource:'cmdb_inventory',resourceId:snapshot.id,status:'success',details:{assetId:asset.id,deviceId:asset.device.id,type}});return snapshot;
  }catch(error){
    if(asset){const now=new Date();await prisma.cmdbInventorySnapshot.create({data:{assetId:asset.id,deviceId:asset.deviceId||'unlinked',status:'failed',error:error.message.slice(0,2000),collectedBy:username}}).catch(()=>{});await prisma.cmdbAsset.update({where:{id:asset.id},data:{lastInventoryAt:now,lastInventoryStatus:'failed',lastInventoryError:error.message.slice(0,1000),updatedBy:username}}).catch(()=>{});await recordCmdbHistory({assetId:asset.id,eventType:'inventory_failed',source:type==='automatic'?'automatic_inventory':'manual_inventory',actor:username,summary:`Falha na coleta de inventário: ${error.message}`,metadata:{deviceId:asset.deviceId}}).catch(()=>{});if(type==='automatic'&&asset.inventoryPolicy)await prisma.cmdbInventoryPolicy.update({where:{assetId:asset.id},data:{lastRunAt:now,lastStatus:'failed',lastError:error.message.slice(0,1000),nextRunAt:nextInventoryAt(asset.inventoryPolicy,new Date(now.getTime()+60000))}}).catch(()=>{});}
    if(!error.statusCode&&/conexão SSH|Handshake failed|timed out|ECONN/i.test(error.message))error.statusCode=502;
    throw error;
  }finally{running.delete(assetId);}
}

export async function saveInventoryPolicy(assetId,input){const asset=await prisma.cmdbAsset.findUnique({where:{id:assetId},include:{device:true}});if(!asset?.device)throw Object.assign(new Error('Ativo vinculado a equipamento não encontrado'),{statusCode:404});const data={enabled:input.enabled===true,frequency:input.frequency==='daily'?'daily':'weekly',hour:Math.max(0,Math.min(23,Number(input.hour)||0)),weekday:Math.max(0,Math.min(6,Number(input.weekday)||0))};data.nextRunAt=data.enabled?nextInventoryAt(data):null;return prisma.cmdbInventoryPolicy.upsert({where:{assetId},update:data,create:{assetId,...data}});}
export async function runCmdbInventoryScheduler(){const due=await prisma.cmdbInventoryPolicy.findMany({where:{enabled:true,nextRunAt:{lte:new Date()},asset:{device:{isActive:true}}},select:{assetId:true}});for(const item of due)await collectCmdbInventory(item.assetId,{username:'system',type:'automatic'}).catch(error=>logger.error(`CMDB inventory ${item.assetId}: ${error.message}`));return due.length;}
