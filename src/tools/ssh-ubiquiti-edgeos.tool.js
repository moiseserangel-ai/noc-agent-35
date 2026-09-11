import { Client } from 'ssh2';
import { getDeviceDecrypted } from '../services/device.service.js';
import { getExecutionContext, isRemediationApproved } from '../security/execution-context.js';
import { formatChangeMarker, normalizeChangeComment, recordDeviceChange } from '../services/device-change.service.js';
import logger from '../utils/logger.js';

const READ_ONLY=/^(?:show\b|ping\b|traceroute\b|mtr\b|ubnt-device-info\b)/i;
const BLOCKED=[/\breboot\b/i,/\bpoweroff\b/i,/\bdelete system image\b/i,/\badd system image\b/i,/\bset system image\b/i,/\bfactory-reset\b/i,/\breset-to-default\b/i];

export function validateEdgeOsCommands(command,approved=isRemediationApproved()){
  const commands=String(command||'').split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  if(!commands.length)return{allowed:false,reason:'Nenhum comando informado',commands};
  if(commands.some(line=>BLOCKED.some(pattern=>pattern.test(line))))return{allowed:false,reason:'Comando destrutivo bloqueado pela política EdgeOS',commands};
  if(!approved&&commands.some(line=>!READ_ONLY.test(line)))return{allowed:false,reason:'Comando de alteração bloqueado: diagnóstico permite somente show, ping, traceroute e mtr.',commands};
  return{allowed:true,commands};
}

export function ensureEdgeOsDescriptions(command,changeComment){
  const description=normalizeChangeComment(changeComment).replace(/[?"'\\]/g,'').slice(0,80);
  const lines=String(command).split(/\r?\n/);
  const additions=[];
  for(const line of lines){
    const match=line.trim().match(/^set interfaces (ethernet|bonding|bridge|switch|vti|wireguard) (\S+)\s+/i);
    if(!match||/\sdescription\s+/i.test(line))continue;
    const prefix=`set interfaces ${match[1]} ${match[2]} description`;
    if(!lines.some(item=>item.trim().toLowerCase().startsWith(prefix.toLowerCase())))additions.push(`${prefix} "${description}"`);
  }
  return [...lines,...new Set(additions)].join('\n');
}

export async function sshEdgeOsExec({deviceId,command,changeComment}){
  const policy=validateEdgeOsCommands(command);
  if(!policy.allowed)return{success:false,output:`⛔ ${policy.reason}`};
  const changing=policy.commands.some(line=>!READ_ONLY.test(line));
  let normalizedComment=null,commands=policy.commands,nativeDescription=false;
  if(changing){
    try{normalizedComment=normalizeChangeComment(changeComment);}catch(error){return{success:false,output:`Alteração bloqueada: ${error.message}`};}
    const enriched=ensureEdgeOsDescriptions(commands.join('\n'),normalizedComment);
    commands=enriched.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
    nativeDescription=enriched!==policy.commands.join('\n');
  }
  const device=await getDeviceDecrypted(deviceId);
  if(!device)return{success:false,output:'Dispositivo não encontrado'};
  if(device.type!=='ubiquiti_edgeos')return{success:false,output:'Dispositivo não é Ubiquiti EdgeOS'};
  logger.info(`SSH Ubiquiti EdgeOS: ${device.hostname} → ${commands.join(' | ')}`);
  return new Promise(resolve=>{
    const conn=new Client();let output='',settled=false;
    const finish=async(success,message)=>{
      if(settled)return;settled=true;clearTimeout(timeout);conn.end();
      const text=message||output.trim()||'(sem saída)';
      const ok=success&&!/(invalid command|configuration path: .* is not valid|commit failed|permission denied)/i.test(text);
      if(normalizedComment&&ok){
        const context=getExecutionContext();
        try{await recordDeviceChange({deviceId,taskNumber:context.taskNumber,agentName:context.agentName||'ubiquiti_edgeos',comment:normalizedComment,nativeAudit:nativeDescription?'EdgeOS interface description + histórico NOC':'histórico NOC'});}catch(error){logger.error(`Falha ao registrar mudança EdgeOS: ${error.message}`);}
      }
      resolve({success:ok,output:`${text}${normalizedComment&&ok?`\n📝 ${formatChangeMarker(normalizedComment,getExecutionContext().taskNumber)}${nativeDescription?'\n🏷️ description nativa aplicada às interfaces EdgeOS compatíveis.':''}`:''}`,device:{name:device.name,hostname:device.hostname}});
    };
    const timeout=setTimeout(()=>finish(false,`Timeout: sessão EdgeOS excedeu 60s em ${device.hostname}\n${output}`),60000);
    conn.on('ready',()=>conn.shell({term:'vt100',cols:240,rows:1000},(error,stream)=>{
      if(error)return finish(false,`Erro ao abrir terminal EdgeOS: ${error.message}`);
      let index=0,lastSentAt=0;
      const sendNext=()=>{if(index>=commands.length){stream.write('exit\n');setTimeout(()=>finish(true),350);return;}const next=commands[index++];output+=`\n$ ${next}\n`;lastSentAt=Date.now();stream.write(`${next}\n`);};
      stream.on('data',data=>{output+=data.toString().replace(/\x1b\[[0-9;?]*[A-Za-z]/g,'');if(Date.now()-lastSentAt>120&&/(?:^|\n)[\w.@:/~-]+[#$>]\s*$/.test(output))sendNext();});
      stream.stderr.on('data',data=>{output+=`\nSTDERR: ${data}`;});stream.on('close',()=>finish(true));setTimeout(sendNext,300);
    }));
    conn.on('error',error=>finish(false,`Erro de conexão SSH: ${error.message}`));
    conn.connect({host:device.hostname,port:device.port,username:device.username,password:device.password,readyTimeout:12000});
  });
}

export const sshEdgeOsToolDefinition={name:'ssh_ubiquiti_edgeos_exec',description:'Executa comandos Ubiquiti EdgeOS via SSH. Diagnóstico aceita show, ping, traceroute e mtr; alterações exigem aprovação.',input_schema:{type:'object',properties:{deviceId:{type:'string'},command:{type:'string'},changeComment:{type:'string',description:'Resumo obrigatório; aplicado como description em interfaces compatíveis.'}},required:['deviceId','command']}};
