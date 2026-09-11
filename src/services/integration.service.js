import prisma from '../database/client.js';
import { decrypt } from '../utils/crypto.js';

const settings=async keys=>{const rows=await prisma.settings.findMany({where:{key:{in:keys}}});return Object.fromEntries(rows.map(row=>[row.key,row.encrypted?decrypt(row.value):row.value]));};

export async function ansibleInventory(){
  const devices=await prisma.device.findMany({where:{isActive:true},select:{name:true,hostname:true,port:true,type:true,username:true,group:true,manufacturer:true,model:true,osVersion:true,tenant:{select:{slug:true,name:true}},site:{select:{name:true}}},orderBy:{name:'asc'}});
  const groups={all:{hosts:[],vars:{ansible_connection:'ssh'}},_meta:{hostvars:{}}};
  for(const device of devices){const host=device.name.replace(/[^A-Za-z0-9_.-]/g,'_'),group=(device.group||device.type||'network').replace(/[^A-Za-z0-9_-]/g,'_');groups[group]??={hosts:[],vars:{}};groups[group].hosts.push(host);groups._meta.hostvars[host]={ansible_host:device.hostname,ansible_port:device.port,ansible_user:device.username,noc_device_type:device.type,noc_manufacturer:device.manufacturer||'',noc_model:device.model||'',noc_os_version:device.osVersion||'',noc_tenant:device.tenant?.slug||'',noc_site:device.site?.name||''};groups.all.hosts.push(host);}
  return {generatedAt:new Date().toISOString(),count:devices.length,inventory:groups};
}

export async function testNetboxConnection(){
  const cfg=await settings(['netbox_url','netbox_api_token']);
  if(!cfg.netbox_url||!cfg.netbox_api_token)throw Object.assign(new Error('Configure netbox_url e netbox_api_token antes do teste'),{statusCode:400});
  const base=String(cfg.netbox_url).replace(/\/$/,'');
  let url;try{url=new URL(`${base}/api/status/`);}catch{throw Object.assign(new Error('URL do NetBox inválida'),{statusCode:400});}
  if(url.protocol!=='https:')throw Object.assign(new Error('O NetBox deve usar HTTPS'),{statusCode:400});
  const response=await fetch(url,{headers:{Authorization:`Token ${cfg.netbox_api_token}`,Accept:'application/json'},signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Object.assign(new Error(`NetBox respondeu HTTP ${response.status}`),{statusCode:502});
  return {url:base,status:'connected'};
}
