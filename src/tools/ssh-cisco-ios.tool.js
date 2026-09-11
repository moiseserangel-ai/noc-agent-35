import { Client } from 'ssh2';
import { getDeviceDecrypted } from '../services/device.service.js';
import { getExecutionContext, isRemediationApproved } from '../security/execution-context.js';
import { formatChangeMarker, normalizeChangeComment, recordDeviceChange } from '../services/device-change.service.js';
import logger from '../utils/logger.js';

const READ_ONLY=/^(?:show\b|ping\b|traceroute\b|terminal length\s+0\b)/i;
const BLOCKED=[/\breload\b/i,/\berase\s+(?:startup-config|nvram)/i,/\bwrite\s+erase\b/i,/\bformat\b/i,/\bdelete\s+\/force\b/i,/\binstall\s+(?:add|activate|commit|remove)\b/i];

export function validateCiscoCommands(command,approved=isRemediationApproved()){
  const commands=String(command||'').split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  if(!commands.length)return{allowed:false,reason:'Nenhum comando informado',commands};
  if(commands.some(line=>BLOCKED.some(pattern=>pattern.test(line))))return{allowed:false,reason:'Comando destrutivo bloqueado pela política Cisco',commands};
  if(!approved&&commands.some(line=>!READ_ONLY.test(line)))return{allowed:false,reason:'Comando de alteração bloqueado: diagnóstico permite somente show, ping e traceroute.',commands};
  return{allowed:true,commands};
}

export function ensureCiscoNativeDescriptions(command,changeComment){
  const description=normalizeChangeComment(changeComment).replace(/[?"'\\]/g,'').slice(0,80);
  const lines=String(command).split(/\r?\n/),result=[];
  for(let index=0;index<lines.length;index++){
    const line=lines[index];result.push(line);
    if(/^interface\s+\S+/i.test(line.trim())){
      const rest=lines.slice(index+1);
      const boundary=rest.findIndex(next=>/^(?:interface\s+|router\s+|line\s+|end\b|exit\b)/i.test(next.trim()));
      const block=rest.slice(0,boundary<0?rest.length:boundary);
      if(!block.some(next=>/^description\s+/i.test(next.trim())))result.push(`description ${description}`);
    }
  }
  return result.join('\n');
}

export async function sshCiscoIosExec({deviceId,command,changeComment}){
  const policy=validateCiscoCommands(command);
  if(!policy.allowed)return{success:false,output:`⛔ ${policy.reason}`};
  const changing=policy.commands.some(line=>!READ_ONLY.test(line));
  let normalizedComment=null,commands=policy.commands,nativeDescription=false;
  if(changing){
    try{normalizedComment=normalizeChangeComment(changeComment);}catch(error){return{success:false,output:`Alteração bloqueada: ${error.message}`};}
    const enriched=ensureCiscoNativeDescriptions(commands.join('\n'),normalizedComment);
    commands=enriched.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
    nativeDescription=enriched!==policy.commands.join('\n');
  }
  const device=await getDeviceDecrypted(deviceId);
  if(!device)return{success:false,output:'Dispositivo não encontrado'};
  if(device.type!=='cisco_ios')return{success:false,output:'Dispositivo não é Cisco IOS/IOS-XE'};
  logger.info(`SSH Cisco IOS: ${device.hostname} → ${commands.join(' | ')}`);
  return new Promise(resolve=>{
    const conn=new Client();let output='',settled=false;
    const finish=async(success,message)=>{
      if(settled)return;settled=true;clearTimeout(timeout);conn.end();
      const text=message||output.trim()||'(sem saída)';
      const ok=success&&!/(% ?Invalid input|% ?Incomplete command|% ?Ambiguous command|authorization failed)/i.test(text);
      if(normalizedComment&&ok){
        const context=getExecutionContext();
        try{await recordDeviceChange({deviceId,taskNumber:context.taskNumber,agentName:context.agentName||'cisco_ios',comment:normalizedComment,nativeAudit:nativeDescription?'Cisco interface description + histórico NOC':'histórico NOC'});}catch(error){logger.error(`Falha ao registrar mudança Cisco: ${error.message}`);}
      }
      resolve({success:ok,output:`${text}${normalizedComment&&ok?`\n📝 ${formatChangeMarker(normalizedComment,getExecutionContext().taskNumber)}${nativeDescription?'\n🏷️ description nativa aplicada às interfaces Cisco compatíveis.':''}`:''}`,device:{name:device.name,hostname:device.hostname}});
    };
    const timeout=setTimeout(()=>finish(false,`Timeout: sessão Cisco excedeu 60s em ${device.hostname}\n${output}`),60000);
    conn.on('ready',()=>conn.shell({term:'vt100',cols:240,rows:1000},(error,stream)=>{
      if(error)return finish(false,`Erro ao abrir terminal Cisco: ${error.message}`);
      const queue=['terminal length 0',...commands];let index=0,lastSentAt=0;
      const sendNext=()=>{if(index>=queue.length){stream.write('exit\n');setTimeout(()=>finish(true),350);return;}const next=queue[index++];output+=`\n$ ${next}\n`;lastSentAt=Date.now();stream.write(`${next}\n`);};
      stream.on('data',data=>{output+=data.toString().replace(/\x1b\[[0-9;?]*[A-Za-z]/g,'');if(Date.now()-lastSentAt>120&&/(?:^|\n)[\w()./-]+(?:\(config[^)]*\))?[#>]\s*$/.test(output))sendNext();});
      stream.stderr.on('data',data=>{output+=`\nSTDERR: ${data}`;});stream.on('close',()=>finish(true));setTimeout(sendNext,300);
    }));
    conn.on('error',error=>finish(false,`Erro de conexão SSH: ${error.message}`));
    conn.connect({host:device.hostname,port:device.port,username:device.username,password:device.password,readyTimeout:12000,algorithms:{kex:['curve25519-sha256','ecdh-sha2-nistp256','diffie-hellman-group14-sha256','diffie-hellman-group14-sha1']}});
  });
}

export const sshCiscoIosToolDefinition={name:'ssh_cisco_ios_exec',description:'Executa comandos Cisco IOS/IOS-XE via SSH. Diagnóstico aceita show, ping e traceroute; alterações exigem aprovação.',input_schema:{type:'object',properties:{deviceId:{type:'string'},command:{type:'string'},changeComment:{type:'string',description:'Resumo obrigatório da alteração; aplicado como description em interfaces compatíveis.'}},required:['deviceId','command']}};
