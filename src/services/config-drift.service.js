import prisma from '../database/client.js';
import { decrypt, encrypt } from '../utils/crypto.js';
import { compareConfigurations } from './configuration-diff.service.js';
import { addTaskMessage, createTask, updateTask } from './task.service.js';
import { notifyTask } from './notification.service.js';
import { logAudit } from './audit.service.js';

export const publicDrift=row=>({...row,evidence:row.evidence?JSON.parse(decrypt(row.evidence)):null});

export async function promoteConfigurationBaseline(backupId, actor='system') {
  const backup=await prisma.deviceConfigBackup.findUnique({where:{id:backupId}});
  if(!backup||backup.status!=='success')throw Object.assign(new Error('Snapshot válido não encontrado para baseline'),{statusCode:404});
  const now=new Date();
  await prisma.$transaction([
    prisma.deviceConfigBackup.updateMany({where:{deviceId:backup.deviceId,isBaseline:true},data:{isBaseline:false,baselineAt:null,baselineBy:null}}),
    prisma.deviceConfigBackup.update({where:{id:backup.id},data:{isBaseline:true,baselineAt:now,baselineBy:actor}}),
  ]);
  return prisma.deviceConfigBackup.findUnique({where:{id:backup.id}});
}

async function baselineFor(after){
  let baseline=await prisma.deviceConfigBackup.findFirst({where:{deviceId:after.deviceId,status:'success',isBaseline:true,id:{not:after.id}},orderBy:{baselineAt:'desc'}});
  if(baseline)return baseline;
  const pending=await prisma.configDrift.findFirst({where:{deviceId:after.deviceId,status:{in:['open','acknowledged','verifying']}},orderBy:{detectedAt:'desc'},select:{beforeBackupId:true}});
  const accepted=pending?null:await prisma.configDrift.findFirst({where:{deviceId:after.deviceId,status:'ignored'},orderBy:{resolvedAt:'desc'},select:{afterBackupId:true}});
  const preferredId=pending?.beforeBackupId||accepted?.afterBackupId;
  baseline=preferredId?await prisma.deviceConfigBackup.findUnique({where:{id:preferredId}}):null;
  if(!baseline)baseline=await prisma.deviceConfigBackup.findFirst({where:{deviceId:after.deviceId,status:'success',id:{not:after.id},createdAt:{lt:after.createdAt}},orderBy:{createdAt:'desc'}});
  if(baseline)await promoteConfigurationBaseline(baseline.id,'system:initial-baseline');
  return baseline;
}

async function resolveOpenDrifts(deviceId,note){
  const now=new Date(),open=await prisma.configDrift.findMany({where:{deviceId,status:{in:['open','acknowledged','verifying']}}});
  if(!open.length)return 0;
  await prisma.configDrift.updateMany({where:{id:{in:open.map(row=>row.id)}},data:{status:'resolved',resolution:note,resolvedBy:'system',resolvedAt:now}});
  for(const item of open.filter(row=>row.taskId)){const task=await updateTask(item.taskId,{status:'resolved',resolvedAt:now,resolutionType:'drift_verified',resolutionSummary:note});await addTaskMessage(item.taskId,'system',note);await notifyTask(task,'resolved',{message:note});}
  return open.length;
}

export async function detectConfigurationDrift(afterBackupId){
  const after=await prisma.deviceConfigBackup.findUnique({where:{id:afterBackupId},include:{device:true}});
  if(!after||after.status!=='success')return null;
  if(!['automatic','manual'].includes(after.type))return null;
  const existing=await prisma.configDrift.findUnique({where:{afterBackupId}});if(existing)return existing;
  const before=await baselineFor(after);if(!before){await promoteConfigurationBaseline(after.id,'system:initial-baseline');return null;}
  const diff=compareConfigurations(decrypt(before.content),decrypt(after.content)),changed=diff.addedCount>0||diff.removedCount>0;
  if(!changed){await resolveOpenDrifts(after.deviceId,'Drift encerrado após nova coleta confirmar que a configuração corresponde ao baseline aprovado.');return null;}
  const open=await prisma.configDrift.findFirst({where:{deviceId:after.deviceId,status:{in:['open','acknowledged','verifying']}},orderBy:{detectedAt:'desc'}});
  if(open){
    const row=await prisma.configDrift.update({where:{id:open.id},data:{beforeBackupId:before.id,afterBackupId:after.id,addedCount:diff.addedCount,removedCount:diff.removedCount,unchangedCount:diff.unchangedCount,evidence:encrypt(JSON.stringify(diff)),status:open.status==='verifying'?'acknowledged':open.status,resolution:open.status==='verifying'?'A verificação confirmou que a divergência ainda existe.':open.resolution,resolvedBy:null,resolvedAt:null}});
    if(open.taskId)await addTaskMessage(open.taskId,'system',open.status==='verifying'?'Nova coleta: a configuração ainda diverge do baseline; a Task permanece aberta.':'Drift atualizado com a coleta mais recente; nenhuma Task duplicada foi criada.');
    return row;
  }
  const drift=await prisma.configDrift.create({data:{deviceId:after.deviceId,beforeBackupId:before.id,afterBackupId:after.id,addedCount:diff.addedCount,removedCount:diff.removedCount,unchangedCount:diff.unchangedCount,evidence:encrypt(JSON.stringify(diff))}});
  const message=`Drift de configuração detectado em ${after.device.name} (${after.device.hostname}).\n${diff.addedCount} linha(s) adicionada(s), ${diff.removedCount} removida(s).\nRevise as evidências antes de aceitar o novo baseline ou preparar correção.`;
  let task=await createTask({source:'config_drift',workType:'configuration',deviceId:after.deviceId,priority:diff.addedCount+diff.removedCount>10?'high':'medium',originalMessage:message,incident:{incidentKey:`config-drift:${drift.id}`,incidentOpenedAt:new Date()}});
  await addTaskMessage(task.id,'system','Alteração identificada por comparação criptográfica entre snapshots, fora de execução controlada.');
  await prisma.configDrift.update({where:{id:drift.id},data:{taskId:task.id}});await notifyTask(task,'opened',{message});
  await logAudit({username:'system',displayName:'Detector de drift',role:'system',action:'detect',resource:'config_drift',resourceId:drift.id,details:{deviceId:after.deviceId,taskNumber:task.taskNumber,added:diff.addedCount,removed:diff.removedCount}});
  return drift;
}

export async function decideConfigurationDrift(id,{action,actor,resolution}){
  const current=await prisma.configDrift.findUnique({where:{id}});if(!current)throw Object.assign(new Error('Drift não encontrado'),{statusCode:404});
  if(!['open','acknowledged','verifying'].includes(current.status))throw Object.assign(new Error('Drift já concluído'),{statusCode:409});
  const now=new Date(),text=String(resolution||'').trim().slice(0,1000);
  if(action==='ignore'){
    await promoteConfigurationBaseline(current.afterBackupId,actor);
    const row=await prisma.configDrift.update({where:{id},data:{status:'ignored',resolution:text||'Configuração aceita como novo baseline.',resolvedBy:actor,resolvedAt:now}});
    const note='Drift aceito como novo baseline pelo administrador.';
    if(current.taskId){await updateTask(current.taskId,{status:'resolved',resolvedAt:now,resolutionType:'drift_ignored',resolutionSummary:note});await addTaskMessage(current.taskId,'system',note);}
    await logAudit({username:actor,displayName:actor,role:'admin',action,status:'success',resource:'config_drift',resourceId:id,details:{resolution:row.resolution,baselineBackupId:current.afterBackupId}});return row;
  }
  const status=action==='acknowledge'?'acknowledged':'verifying';
  const row=await prisma.configDrift.update({where:{id},data:{status,acknowledgedBy:actor,acknowledgedAt:now,resolution:action==='resolve'?(text||'Verificação solicitada pelo operador.'):current.resolution,resolvedBy:null,resolvedAt:null}});
  if(current.taskId)await addTaskMessage(current.taskId,'system',action==='resolve'?'Resolução informada; será feita uma nova coleta somente leitura para confirmar o retorno ao baseline.':'Drift reconhecido pelo operador.');
  await logAudit({username:actor,displayName:actor,role:'admin',action,status:'success',resource:'config_drift',resourceId:id,details:{resolution:row.resolution}});return row;
}
