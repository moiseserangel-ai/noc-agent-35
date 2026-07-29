import { Client } from 'ssh2';
import { getDeviceDecrypted } from '../services/device.service.js';
import { getExecutionContext, isRemediationApproved } from '../security/execution-context.js';
import { formatChangeMarker, normalizeChangeComment, recordDeviceChange } from '../services/device-change.service.js';
import logger from '../utils/logger.js';

const PROFILES={
  datacom_dmos:{
    label:'Datacom DMOS',read:/^(?:show\b|ping\b|traceroute\b)/i,
    blocked:[/\breload\b/i,/\breboot\b/i,/\berase\b/i,/\bformat\b/i,/\bdelete\s+startup/i,/\binstall\s+image\b/i],
    prompt:/(?:^|\n)[\w()./@:-]+[>#]\s*$/,paging:'terminal length 0',
  },
  nokia_sros:{
    label:'Nokia SR OS',read:/^(?:show\b|ping\b|traceroute\b|tools perform ping\b|tools perform traceroute\b|environment more false\b)/i,
    blocked:[/\badmin reboot\b/i,/\badmin shutdown\b/i,/\badmin factory-reset\b/i,/\bfile delete\b/i,/\bclear bof\b/i,/\badmin software\b/i],
    prompt:/(?:^|\n)[\w()./@:[\]-]+[>#]\s*$/,paging:'environment more false',
  },
};

export function validateProfiledCommands(type,command,approved=isRemediationApproved()){
  const profile=PROFILES[type];const commands=String(command||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  if(!profile)return{allowed:false,reason:'Perfil não suportado',commands};
  if(!commands.length)return{allowed:false,reason:'Nenhum comando informado',commands};
  if(commands.some(line=>profile.blocked.some(pattern=>pattern.test(line))))return{allowed:false,reason:`Comando destrutivo bloqueado pela política ${profile.label}`,commands};
  if(!approved&&commands.some(line=>!profile.read.test(line)))return{allowed:false,reason:`Alteração bloqueada: diagnóstico ${profile.label} permite somente comandos de leitura.`,commands};
  return{allowed:true,commands};
}

export function addProfiledDescriptions(type,command,comment){
  const description=normalizeChangeComment(comment).replace(/[?"'\\]/g,'').slice(0,80);
  const lines=String(command).split(/\r?\n/),result=[];
  for(let index=0;index<lines.length;index++){
    const line=lines[index];result.push(line);
    if(type==='datacom_dmos'&&/^interface\s+\S+/i.test(line.trim())&&!lines.slice(index+1).some(x=>/^description\s+/i.test(x.trim())))result.push(`description ${description}`);
    if(type==='nokia_sros'&&/^\/?configure\s+port\s+\S+/i.test(line.trim())&&!lines.some(x=>/\bdescription\b/i.test(x.trim())))result.push(`description "${description}"`);
  }
  return result.join('\n');
}

export async function executeProfiledNetwork(type,{deviceId,command,changeComment}){
  const profile=PROFILES[type],policy=validateProfiledCommands(type,command);
  if(!policy.allowed)return{success:false,output:`⛔ ${policy.reason}`};
  const changing=policy.commands.some(line=>!profile.read.test(line));let comment=null,commands=policy.commands,native=false;
  if(changing){try{comment=normalizeChangeComment(changeComment);}catch(error){return{success:false,output:`Alteração bloqueada: ${error.message}`};}const enriched=addProfiledDescriptions(type,commands.join('\n'),comment);commands=enriched.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);native=enriched!==policy.commands.join('\n');}
  const device=await getDeviceDecrypted(deviceId);if(!device)return{success:false,output:'Dispositivo não encontrado'};if(device.type!==type)return{success:false,output:`Dispositivo não é ${profile.label}`};
  logger.info(`SSH ${profile.label}: ${device.hostname} → ${commands.join(' | ')}`);
  return new Promise(resolve=>{
    const conn=new Client();let output='',settled=false;
    const finish=async(success,message)=>{if(settled)return;settled=true;clearTimeout(timeout);conn.end();const text=message||output.trim()||'(sem saída)';const ok=success&&!/(invalid input|unknown command|syntax error|commit failed|permission denied)/i.test(text);
      if(comment&&ok){const context=getExecutionContext();try{await recordDeviceChange({deviceId,taskNumber:context.taskNumber,agentName:context.agentName||type,comment,nativeAudit:native?`${profile.label} description + histórico NOC`:'histórico NOC'});}catch(error){logger.error(error.message);}}
      resolve({success:ok,output:`${text}${comment&&ok?`\n📝 ${formatChangeMarker(comment,getExecutionContext().taskNumber)}${native?'\n🏷️ description nativa aplicada.':''}`:''}`,device:{name:device.name,hostname:device.hostname}});
    };
    const timeout=setTimeout(()=>finish(false,`Timeout ${profile.label}\n${output}`),60000);
    conn.on('ready',()=>conn.shell({term:'vt100',cols:240,rows:1000},(error,stream)=>{if(error)return finish(false,error.message);const queue=[profile.paging,...commands];let index=0,last=0;const next=()=>{if(index>=queue.length){stream.write('exit\n');setTimeout(()=>finish(true),350);return;}const item=queue[index++];output+=`\n$ ${item}\n`;last=Date.now();stream.write(`${item}\n`);};stream.on('data',data=>{output+=data.toString().replace(/\x1b\[[0-9;?]*[A-Za-z]/g,'');if(Date.now()-last>120&&profile.prompt.test(output))next();});stream.on('close',()=>finish(true));setTimeout(next,300);}));
    conn.on('error',error=>finish(false,error.message));conn.connect({host:device.hostname,port:device.port,username:device.username,password:device.password,readyTimeout:12000});
  });
}

export const sshDatacomDmosExec=input=>executeProfiledNetwork('datacom_dmos',input);
export const sshNokiaSrosExec=input=>executeProfiledNetwork('nokia_sros',input);
export const datacomToolDefinition={name:'ssh_datacom_dmos_exec',description:'Executa CLI Datacom DMOS via SSH com política segura.',input_schema:{type:'object',properties:{deviceId:{type:'string'},command:{type:'string'},changeComment:{type:'string'}},required:['deviceId','command']}};
export const nokiaToolDefinition={name:'ssh_nokia_sros_exec',description:'Executa CLI Nokia SR OS via SSH com política segura.',input_schema:{type:'object',properties:{deviceId:{type:'string'},command:{type:'string'},changeComment:{type:'string'}},required:['deviceId','command']}};
