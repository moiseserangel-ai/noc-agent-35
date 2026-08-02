import prisma from '../database/client.js';
import { decrypt, encrypt } from '../utils/crypto.js';
import { compareConfigurations } from './configuration-diff.service.js';
import { addTaskMessage, createTask, updateTask } from './task.service.js';
import { notifyTask } from './notification.service.js';
import { logAudit } from './audit.service.js';

export const publicDrift=row=>({...row,evidence:row.evidence?JSON.parse(decrypt(row.evidence)):null});

export async function detectConfigurationDrift(afterBackupId){
  const after=await prisma.deviceConfigBackup.findUnique({where:{id:afterBackupId},include:{device:true}});
  if(!after||after.status!=='success'||!['automatic','manual'].includes(after.type))return null;
  const existing=await prisma.configDrift.findUnique({where:{afterBackupId}});if(existing)return existing;
  const before=await prisma.deviceConfigBackup.findFirst({where:{deviceId:after.deviceId,status:'success',id:{not:after.id},createdAt:{lt:after.createdAt}},orderBy:{createdAt:'desc'}});if(!before)return null;
  const diff=compareConfigurations(decrypt(before.content),decrypt(after.content)),changed=diff.addedCount>0||diff.removedCount>0;
  if(!changed){const now=new Date(),open=await prisma.configDrift.findMany({where:{deviceId:after.deviceId,status:{in:['open','acknowledged']}}});await prisma.configDrift.updateMany({where:{id:{in:open.map(row=>row.id)}},data:{status:'resolved',resolution:'Configuração retornou ao baseline observado.',resolvedBy:'system',resolvedAt:now}});for(const item of open.filter(row=>row.taskId)){const note='Drift resolvido automaticamente: a configuração retornou ao baseline observado.';const task=await updateTask(item.taskId,{status:'resolved',resolvedAt:now,resolutionType:'drift_automatic',resolutionSummary:note});await addTaskMessage(item.taskId,'system',note);await notifyTask(task,'resolved',{message:note});}return null;}
  const drift=await prisma.configDrift.create({data:{deviceId:after.deviceId,beforeBackupId:before.id,afterBackupId:after.id,addedCount:diff.addedCount,removedCount:diff.removedCount,unchangedCount:diff.unchangedCount,evidence:encrypt(JSON.stringify(diff))}});
  const message=`Drift de configuração detectado em ${after.device.name} (${after.device.hostname}).\n${diff.addedCount} linha(s) adicionada(s), ${diff.removedCount} removida(s).\nRevise as evidências antes de aceitar o novo baseline ou preparar correção.`;
  let task=await createTask({source:'config_drift',workType:'configuration',deviceId:after.deviceId,priority:diff.addedCount+diff.removedCount>10?'high':'medium',originalMessage:message,incident:{incidentKey:`config-drift:${drift.id}`,incidentOpenedAt:new Date()}});
  await addTaskMessage(task.id,'system','Alteração identificada por comparação criptográfica entre snapshots, fora de execução controlada.');
  await prisma.configDrift.update({where:{id:drift.id},data:{taskId:task.id}});await notifyTask(task,'opened',{message});
  await logAudit({username:'system',displayName:'Detector de drift',role:'system',action:'detect',resource:'config_drift',resourceId:drift.id,details:{deviceId:after.deviceId,taskNumber:task.taskNumber,added:diff.addedCount,removed:diff.removedCount}});
  return drift;
}

export async function decideConfigurationDrift(id,{action,actor,resolution}){const current=await prisma.configDrift.findUnique({where:{id}});if(!current)throw Object.assign(new Error('Drift não encontrado'),{statusCode:404});const status=action==='acknowledge'?'acknowledged':action==='ignore'?'ignored':'resolved',now=new Date(),row=await prisma.configDrift.update({where:{id},data:status==='acknowledged'?{status,acknowledgedBy:actor,acknowledgedAt:now}:{status,resolution:String(resolution||'').trim().slice(0,1000)||null,resolvedBy:actor,resolvedAt:now}});if(current.taskId&&status!=='acknowledged'){const note=status==='ignored'?'Drift aceito como novo baseline pelo administrador.':`Drift resolvido: ${row.resolution||'configuração regularizada'}.`;await updateTask(current.taskId,{status:'resolved',resolvedAt:now,resolutionType:`drift_${status}`,resolutionSummary:note});await addTaskMessage(current.taskId,'system',note);}await logAudit({username:actor,displayName:actor,role:'admin',action,status:'success',resource:'config_drift',resourceId:id,details:{resolution:row.resolution}});return row;}
