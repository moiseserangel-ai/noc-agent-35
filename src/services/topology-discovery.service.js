import prisma from '../database/client.js';
import logger from '../utils/logger.js';
import { sshMikrotikExec } from '../tools/ssh-mikrotik.tool.js';
import { sshHuaweiVrpExec } from '../tools/ssh-huawei-vrp.tool.js';
import { sshCiscoIosExec } from '../tools/ssh-cisco-ios.tool.js';
import { sshJuniperJunosExec } from '../tools/ssh-juniper-junos.tool.js';
import { sshFortiGateExec } from '../tools/ssh-fortigate-fortios.tool.js';
import { sshEdgeOsExec } from '../tools/ssh-ubiquiti-edgeos.tool.js';
import { sshDatacomDmosExec, sshNokiaSrosExec } from '../tools/ssh-profiled-network.tool.js';

let running = false;
const clean = value => String(value || '').trim().replace(/^"|"$/g, '');
const normalized = value => clean(value).toLowerCase().replace(/[^a-z0-9]/g, '');

export function parseMikrotikNeighbors(output) {
  const source = String(output || '').replace(/\r/g, '');
  const starts = [...source.matchAll(/(?:^|\n)\s*\d+\s+(?=[A-Z ]*\binterface=)/g)];
  const blocks = starts.length
    ? starts.map((match, index) => source.slice(match.index, starts[index + 1]?.index ?? source.length))
    : source.split(/\n\s*\n/);
  return blocks.map(block => {
    const values = {};
    for (const match of block.matchAll(/([\w-]+)=(?:"([^"]*)"|([^\s]+))/g)) values[match[1]] = clean(match[2] ?? match[3]);
    if (!values.interface || !(values.identity || values.address || values['address4'] || values['mac-address'])) return null;
    const protocols = String(values['discovered-by'] || '').toLowerCase();
    return {
      protocol: protocols.includes('lldp') ? 'lldp' : 'mndp',
      localInterface: values.interface,
      remoteInterface: values['interface-name'] || null,
      remoteName: values.identity || null,
      remoteIp: values.address4 || values.address || null,
      remoteChassisId: values['mac-address'] || null,
      remotePlatform: values.platform || values.board || values.version || null,
    };
  }).filter(Boolean);
}

export function parseHuaweiLldpBrief(output) {
  const rows = [];
  for (const raw of String(output || '').replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line || /^[$<\[]/.test(line) || /neighbor|local\s+int|port\s+id|expire|total/i.test(line) || /^[-=]+$/.test(line)) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 3 || !/^(?:GE|XGE|Eth|GigabitEthernet|XGigabitEthernet|Ethernet|100GE|40GE|10GE|MEth|Vlanif)/i.test(parts[0])) continue;
    const numericIndex = parts.findIndex((part, index) => index > 1 && /^\d+$/.test(part));
    const remoteInterface = numericIndex > 2 ? parts[numericIndex - 1] : parts.at(-1);
    const remoteName = parts.slice(1, numericIndex > 2 ? numericIndex - 1 : -1).join(' ') || parts[1];
    rows.push({ protocol:'lldp', localInterface:parts[0], remoteInterface, remoteName, remoteIp:null, remoteChassisId:null, remotePlatform:null });
  }
  return rows;
}

export function parseCiscoNeighbors(output) {
  const text=String(output||'').replace(/\r/g,'');
  const sections=text.split(/(?=Device ID:|System Name:)/i).filter(block=>/^(?:Device ID|System Name):/i.test(block.trim()));
  return sections.map(block=>{
    const cdp=/^Device ID:/i.test(block.trim());
    const value=pattern=>(block.match(pattern)||[])[1]?.trim()||null;
    return {
      protocol:cdp?'cdp':'lldp',
      localInterface:value(/Interface:\s*([^,\n]+)/i)||value(/Local (?:Intf|Interface):\s*([^\n]+)/i),
      remoteInterface:value(/Port ID \(outgoing port\):\s*([^\n]+)/i)||value(/Port id:\s*([^\n]+)/i),
      remoteName:value(/(?:Device ID|System Name):\s*([^\n]+)/i),
      remoteIp:value(/(?:IP address|Management Address):\s*([0-9a-f:.]+)/i),
      remoteChassisId:value(/Chassis id:\s*([^\n]+)/i),
      remotePlatform:value(/Platform:\s*([^,\n]+)/i)||value(/System Description:\s*([^\n]+)/i),
    };
  }).filter(item=>item.remoteName||item.remoteIp||item.remoteChassisId);
}

export function parseJuniperNeighbors(output) {
  const rows = [];
  for (const raw of String(output || '').replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line || /^[$>@]/.test(line) || /^(?:Local Interface|Parent Interface|Interface|[-=]+|Total entries)/i.test(line)) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 4 || !/^(?:ge-|xe-|et-|ae|reth|em|fxp)\S+/i.test(parts[0])) continue;
    rows.push({
      protocol:'lldp',
      localInterface:parts[0],
      remoteInterface:parts.at(-2),
      remoteName:parts.at(-1),
      remoteIp:null,
      remoteChassisId:parts.length >= 5 ? parts.slice(2, -2).join(' ') : null,
      remotePlatform:null,
    });
  }
  return rows;
}

export function parseFortiGateNeighbors(output) {
  const rows=[];
  let current=null;
  for(const raw of String(output||'').replace(/\r/g,'').split('\n')){
    const line=raw.trim();
    const local=line.match(/^(?:Interface|Local Port)\s*[:=]\s*(\S+)/i);
    if(local){if(current?.localInterface)rows.push(current);current={protocol:'lldp',localInterface:local[1],remoteInterface:null,remoteName:null,remoteIp:null,remoteChassisId:null,remotePlatform:null};continue;}
    if(!current)continue;
    const value=pattern=>(line.match(pattern)||[])[1]?.trim();
    current.remoteName ||= value(/^(?:System Name|Hostname)\s*[:=]\s*(.+)$/i);
    current.remoteInterface ||= value(/^(?:Port ID|Port Description)\s*[:=]\s*(.+)$/i);
    current.remoteChassisId ||= value(/^Chassis ID\s*[:=]\s*(.+)$/i);
    current.remoteIp ||= value(/^(?:Management Address|Management IP)\s*[:=]\s*([0-9a-f:.]+)$/i);
  }
  if(current?.localInterface)rows.push(current);
  return rows.filter(item=>item.remoteName||item.remoteInterface||item.remoteChassisId);
}

export function parseEdgeOsNeighbors(output){
  const rows=[];let current=null;
  for(const raw of String(output||'').replace(/\r/g,'').split('\n')){
    const line=raw.trim();const local=line.match(/^Local (?:Port|Interface)\s*[:=]\s*(\S+)/i);
    if(local){if(current?.localInterface)rows.push(current);current={protocol:'lldp',localInterface:local[1],remoteInterface:null,remoteName:null,remoteIp:null,remoteChassisId:null,remotePlatform:null};continue;}
    if(!current)continue;const value=pattern=>(line.match(pattern)||[])[1]?.trim();
    current.remoteName||=value(/^System Name\s*[:=]\s*(.+)$/i);current.remoteInterface||=value(/^Port (?:ID|Description)\s*[:=]\s*(.+)$/i);current.remoteChassisId||=value(/^Chassis ID\s*[:=]\s*(.+)$/i);current.remoteIp||=value(/^Management Address\s*[:=]\s*([0-9a-f:.]+)$/i);
  }
  if(current?.localInterface)rows.push(current);return rows.filter(item=>item.remoteName||item.remoteInterface);
}

function parseLldpDetailBlocks(output, localPatterns) {
  const rows=[];let current=null;
  for(const raw of String(output||'').replace(/\r/g,'').split('\n')){
    const line=raw.trim();
    const local=localPatterns.map(pattern=>line.match(pattern)).find(Boolean);
    if(local){if(current?.localInterface)rows.push(current);current={protocol:'lldp',localInterface:local[1],remoteInterface:null,remoteName:null,remoteIp:null,remoteChassisId:null,remotePlatform:null};continue;}
    if(!current)continue;
    const value=pattern=>(line.match(pattern)||[])[1]?.trim()||null;
    current.remoteName ||= value(/^(?:System Name|Neighbor Name|System-Name)\s*[:=]\s*(.+)$/i);
    current.remoteInterface ||= value(/^(?:Port ID|Port Description|Remote Port|Port-Id)\s*[:=]\s*(.+)$/i);
    current.remoteChassisId ||= value(/^(?:Chassis ID|Chassis-Id)\s*[:=]\s*(.+)$/i);
    current.remoteIp ||= value(/^(?:Management Address|Management IP|Mgmt Address)\s*[:=]\s*([0-9a-f:.]+)$/i);
    current.remotePlatform ||= value(/^(?:System Description|Platform)\s*[:=]\s*(.+)$/i);
  }
  if(current?.localInterface)rows.push(current);
  return rows.filter(item=>item.remoteName||item.remoteInterface||item.remoteChassisId);
}

export function parseDatacomNeighbors(output){
  const detailed=parseLldpDetailBlocks(output,[/^(?:Local Interface|Local Port|Interface)\s*[:=]\s*(\S+)/i]);
  if(detailed.length)return detailed;
  const rows=[];
  for(const raw of String(output||'').replace(/\r/g,'').split('\n')){
    const line=raw.trim();if(!line||/local|neighbor|chassis|^-+$/i.test(line))continue;
    const parts=line.split(/\s+/);if(parts.length<3||!/^(?:eth|ethernet|gigabit|ten|hundred|1\/|0\/)\S*/i.test(parts[0]))continue;
    rows.push({protocol:'lldp',localInterface:parts[0],remoteName:parts[1],remoteInterface:parts[2],remoteIp:null,remoteChassisId:null,remotePlatform:null});
  }
  return rows;
}

export function parseNokiaNeighbors(output){
  return parseLldpDetailBlocks(output,[/^(?:Local Port|Local Interface|Port)\s*[:=]\s*(\S+)/i]);
}

export function correlateNeighbor(neighbor, devices, localDeviceId) {
  const candidates = devices.filter(device => device.id !== localDeviceId);
  const ip = clean(neighbor.remoteIp);
  if (ip) {
    const exact = candidates.find(device => clean(device.hostname) === ip);
    if (exact) return { deviceId: exact.id, confidence: 100 };
  }
  const remote = normalized(neighbor.remoteName);
  if (remote) {
    const exact = candidates.find(device => [device.name, device.hostname].some(value => normalized(value) === remote));
    if (exact) return { deviceId: exact.id, confidence: 95 };
    const partial = candidates.find(device => [device.name, device.hostname].some(value => {
      const candidate = normalized(value);
      return candidate.length >= 5 && (candidate.includes(remote) || remote.includes(candidate));
    }));
    if (partial) return { deviceId: partial.id, confidence: 75 };
  }
  return { deviceId: null, confidence: 0 };
}

async function collectDevice(device) {
  if (device.type === 'mikrotik') {
    const result = await sshMikrotikExec({ deviceId:device.id, command:'/ip neighbor print detail without-paging' });
    if (!result.success) throw new Error(result.output);
    return parseMikrotikNeighbors(result.output);
  }
  if (device.type === 'huawei_vrp') {
    const result = await sshHuaweiVrpExec({ deviceId:device.id, command:'display lldp neighbor brief' });
    if (!result.success) throw new Error(result.output);
    return parseHuaweiLldpBrief(result.output);
  }
  if(device.type==='cisco_ios'){
    const result=await sshCiscoIosExec({deviceId:device.id,command:'show lldp neighbors detail\nshow cdp neighbors detail'});
    if(!result.success)throw new Error(result.output);
    return parseCiscoNeighbors(result.output);
  }
  if(device.type==='juniper_junos'){
    const result=await sshJuniperJunosExec({deviceId:device.id,command:'show lldp neighbors'});
    if(!result.success)throw new Error(result.output);
    return parseJuniperNeighbors(result.output);
  }
  if(device.type==='fortigate_fortios'){
    const result=await sshFortiGateExec({deviceId:device.id,command:'diagnose lldprx neighbor summary'});
    if(!result.success)throw new Error(result.output);
    return parseFortiGateNeighbors(result.output);
  }
  if(device.type==='ubiquiti_edgeos'){
    const result=await sshEdgeOsExec({deviceId:device.id,command:'show lldp neighbors detail'});
    if(!result.success)throw new Error(result.output);
    return parseEdgeOsNeighbors(result.output);
  }
  if(device.type==='datacom_dmos'){
    const result=await sshDatacomDmosExec({deviceId:device.id,command:'show lldp neighbors detail'});
    if(!result.success)throw new Error(result.output);
    return parseDatacomNeighbors(result.output);
  }
  if(device.type==='nokia_sros'){
    const result=await sshNokiaSrosExec({deviceId:device.id,command:'show system lldp neighbor'});
    if(!result.success)throw new Error(result.output);
    return parseNokiaNeighbors(result.output);
  }
  return [];
}

async function worker(runId) {
  running = true;
  const errors = [];
  try {
    const devices = await prisma.device.findMany({ where:{isActive:true,type:{in:['mikrotik','huawei_vrp','cisco_ios','juniper_junos','fortigate_fortios','ubiquiti_edgeos','datacom_dmos','nokia_sros']}}, select:{id:true,name:true,hostname:true,type:true} });
    await prisma.topologyDiscoveryRun.update({ where:{id:runId}, data:{status:'running',total:devices.length,startedAt:new Date()} });
    await prisma.topologyNeighbor.updateMany({ where:{status:{in:['suggested','confirmed','unmatched','conflict']}}, data:{status:'stale'} });
    for (const device of devices) {
      try {
        const found = await collectDevice(device);
        for (const neighbor of found.slice(0, 300)) {
          const match = correlateNeighbor(neighbor, devices, device.id);
          await prisma.topologyNeighbor.create({ data:{
            runId,localDeviceId:device.id,matchedDeviceId:match.deviceId,protocol:neighbor.protocol,
            localInterface:neighbor.localInterface,remoteInterface:neighbor.remoteInterface,remoteName:neighbor.remoteName,
            remoteIp:neighbor.remoteIp,remoteChassisId:neighbor.remoteChassisId,remotePlatform:neighbor.remotePlatform,
            confidence:match.confidence,status:match.deviceId?'suggested':'unmatched',
          }});
        }
        await prisma.topologyDiscoveryRun.update({where:{id:runId},data:{scanned:{increment:1},found:{increment:found.length},matched:{increment:found.filter(item=>correlateNeighbor(item,devices,device.id).deviceId).length}}});
      } catch (error) {
        errors.push(`${device.name}: ${String(error.message).slice(0,300)}`);
        await prisma.topologyDiscoveryRun.update({where:{id:runId},data:{scanned:{increment:1}}});
      }
    }
    const suggestions = await prisma.topologyNeighbor.findMany({where:{runId,matchedDeviceId:{not:null}}});
    for (const item of suggestions) {
      const reverse = suggestions.find(other => other.localDeviceId === item.matchedDeviceId && other.matchedDeviceId === item.localDeviceId);
      const conflict = suggestions.some(other => other.id !== item.id && other.localDeviceId === item.localDeviceId && other.localInterface && other.localInterface === item.localInterface && other.matchedDeviceId !== item.matchedDeviceId);
      await prisma.topologyNeighbor.update({where:{id:item.id},data:{status:conflict?'conflict':reverse?'confirmed':'suggested'}});
    }
    await prisma.topologyDiscoveryRun.update({where:{id:runId},data:{status:errors.length?'completed_with_errors':'completed',errors:errors.length?JSON.stringify(errors):null,completedAt:new Date()}});
  } catch (error) {
    await prisma.topologyDiscoveryRun.update({where:{id:runId},data:{status:'failed',errors:JSON.stringify([error.message]),completedAt:new Date()}}).catch(()=>{});
    logger.error(`Topology discovery ${runId}: ${error.message}`);
  } finally { running = false; }
}

export async function startTopologyDiscovery(username) {
  const active = await prisma.topologyDiscoveryRun.findFirst({where:{status:{in:['queued','running']}},orderBy:{createdAt:'desc'}});
  if (running || active) throw Object.assign(new Error('Já existe uma descoberta de topologia em andamento'),{statusCode:409});
  const run = await prisma.topologyDiscoveryRun.create({data:{createdBy:username}});
  setImmediate(()=>worker(run.id));
  return run;
}

export async function topologyDiscoveryDashboard() {
  const [runs,suggestions] = await Promise.all([
    prisma.topologyDiscoveryRun.findMany({orderBy:{createdAt:'desc'},take:10}),
    prisma.topologyNeighbor.findMany({
      where:{status:{not:'stale'}},
      include:{localDevice:{select:{id:true,name:true,hostname:true}},matchedDevice:{select:{id:true,name:true,hostname:true}}},
      orderBy:[{status:'asc'},{confidence:'desc'},{createdAt:'desc'}],take:1000,
    }),
  ]);
  return {runs,suggestions};
}

export async function approveTopologyNeighbor(id,username) {
  const neighbor=await prisma.topologyNeighbor.findUnique({where:{id},include:{localDevice:true,matchedDevice:true}});
  if(!neighbor?.matchedDeviceId)throw Object.assign(new Error('Vizinho não relacionado a um equipamento cadastrado'),{statusCode:400});
  const [sourceDeviceId,targetDeviceId]=[neighbor.localDeviceId,neighbor.matchedDeviceId].sort();
  const label=[neighbor.localInterface,neighbor.remoteInterface].filter(Boolean).join(' ↔ ')||null;
  const link=await prisma.topologyLink.upsert({
    where:{sourceDeviceId_targetDeviceId:{sourceDeviceId,targetDeviceId}},
    update:{label,source:neighbor.protocol,updatedAt:new Date()},
    create:{sourceDeviceId,targetDeviceId,label,linkType:'ethernet',source:neighbor.protocol,createdBy:username},
  });
  await prisma.topologyNeighbor.updateMany({where:{OR:[
    {localDeviceId:neighbor.localDeviceId,matchedDeviceId:neighbor.matchedDeviceId},
    {localDeviceId:neighbor.matchedDeviceId,matchedDeviceId:neighbor.localDeviceId},
  ],status:{not:'stale'}},data:{status:'approved',topologyLinkId:link.id,approvedBy:username,approvedAt:new Date()}});
  return link;
}

export async function ignoreTopologyNeighbor(id,username) {
  return prisma.topologyNeighbor.update({where:{id},data:{status:'ignored',ignoredBy:username,ignoredAt:new Date()}});
}
