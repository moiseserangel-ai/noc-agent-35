import https from 'node:https';
import { getDeviceDecrypted } from '../services/device.service.js';
import logger from '../utils/logger.js';

const OPERATIONS={
  status:{modern:'/proxy/network/api/s/default/stat/health',legacy:'/api/s/default/stat/health'},
  sites:{modern:'/proxy/network/api/self/sites',legacy:'/api/self/sites'},
  devices:{modern:'/proxy/network/api/s/default/stat/device',legacy:'/api/s/default/stat/device'},
  clients:{modern:'/proxy/network/api/s/default/stat/sta',legacy:'/api/s/default/stat/sta'},
  alarms:{modern:'/proxy/network/api/s/default/stat/alarm',legacy:'/api/s/default/stat/alarm'},
};

function normalizeBase(hostname,port){
  const raw=String(hostname||'').trim();
  if(/^https?:\/\//i.test(raw))return new URL(raw);
  return new URL(`https://${raw}${port&&Number(port)!==443?`:${port}`:''}`);
}

function request(url,{method='GET',body,cookie,csrf}={}){
  return new Promise((resolve,reject)=>{
    const data=body?JSON.stringify(body):null;
    const req=https.request(url,{method,agent:new https.Agent({rejectUnauthorized:false}),headers:{Accept:'application/json','Content-Type':'application/json',...(data&&{'Content-Length':Buffer.byteLength(data)}),...(cookie&&{Cookie:cookie}),...(csrf&&{'X-Csrf-Token':csrf})}},res=>{
      let output='';res.on('data',chunk=>{output+=chunk;if(output.length>5_000_000)req.destroy(new Error('Resposta UniFi excedeu o limite'));});
      res.on('end',()=>{let json;try{json=output?JSON.parse(output):{};}catch{json={raw:output};}resolve({status:res.statusCode,headers:res.headers,json});});
    });req.on('error',reject);req.setTimeout(15000,()=>req.destroy(new Error('Timeout da API UniFi')));if(data)req.write(data);req.end();
  });
}

async function login(base,username,password){
  for(const mode of ['modern','legacy']){
    const path=mode==='modern'?'/api/auth/login':'/api/login';
    const response=await request(new URL(path,base),{method:'POST',body:{username,password,remember:false}});
    if(response.status>=200&&response.status<300){
      const cookies=(response.headers['set-cookie']||[]).map(value=>value.split(';')[0]).join('; ');
      return{mode,cookie:cookies,csrf:response.headers['x-csrf-token']||response.json?.csrfToken||null};
    }
    if(![400,401,403,404].includes(response.status))throw new Error(`Login UniFi retornou HTTP ${response.status}`);
  }
  throw new Error('Falha de autenticação UniFi. Verifique endereço, usuário local e senha.');
}

export function validateUniFiOperation(operation){
  return Object.hasOwn(OPERATIONS,String(operation||''))?{allowed:true,operation:String(operation)}:{allowed:false,reason:'Operação UniFi não permitida'};
}

export async function unifiControllerQuery({deviceId,operation='status'}){
  const policy=validateUniFiOperation(operation);
  if(!policy.allowed)return{success:false,output:`⛔ ${policy.reason}`};
  const device=await getDeviceDecrypted(deviceId);
  if(!device)return{success:false,output:'Controlador não encontrado'};
  if(device.type!=='unifi_controller')return{success:false,output:'Dispositivo não é UniFi Controller'};
  try{
    const base=normalizeBase(device.hostname,device.port);
    const session=await login(base,device.username,device.password);
    const target=new URL(OPERATIONS[policy.operation][session.mode],base);
    const response=await request(target,{cookie:session.cookie,csrf:session.csrf});
    if(response.status<200||response.status>=300)return{success:false,output:`API UniFi retornou HTTP ${response.status}`};
    const rows=response.json?.data??response.json;
    const limited=Array.isArray(rows)?rows.slice(0,500):rows;
    logger.info(`UniFi API: ${device.name} → ${policy.operation}`);
    return{success:true,output:JSON.stringify(limited,null,2),data:limited,device:{name:device.name,hostname:device.hostname}};
  }catch(error){return{success:false,output:`Erro na API UniFi: ${error.message}`};}
}

export const unifiControllerToolDefinition={name:'unifi_controller_query',description:'Consulta somente leitura no UniFi Controller: status, sites, devices, clients ou alarms.',input_schema:{type:'object',properties:{deviceId:{type:'string'},operation:{type:'string',enum:Object.keys(OPERATIONS)}},required:['deviceId','operation']}};
