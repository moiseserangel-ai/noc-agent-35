import prisma from '../database/client.js';
import { runDeviceBackup } from './device-backup.service.js';
import { runComplianceScan } from './compliance.service.js';
import { addTaskMessage, createTask, updateTask } from './task.service.js';
import { remediationNeedsPlanning } from './compliance.service.js';

export const CHANGE_STATUSES = ['draft','awaiting_approval','approved','in_progress','validating','completed','failed_validation','rollback_requested','rolled_back','rejected','cancelled'];

export function calculateChangeRisk(input, deviceCount = 1) {
  let score = 0;
  if (input.changeType === 'emergency') score += 30;
  else if (input.changeType === 'normal') score += 15;
  score += Math.min(Math.max(deviceCount - 1, 0) * 6, 24);
  const text = `${input.impact || ''} ${input.executionPlan || ''}`.toLowerCase();
  if (/core|borda|bgp|ospf|mpls|firewall|nat|rota|gateway|internet/.test(text)) score += 20;
  if (/indispon|interrup|downtime|queda|reinici|reboot/.test(text)) score += 20;
  if (!input.windowStart || !input.windowEnd) score += 10;
  if (String(input.rollbackPlan || '').trim().length < 30) score += 15;
  score = Math.min(score, 100);
  return { score, level:score >= 70 ? 'critical' : score >= 45 ? 'high' : score >= 20 ? 'medium' : 'low' };
}

export function validateChangeWindow(start, end) {
  if (!start || !end) return { start:null, end:null };
  const windowStart = new Date(start);
  const windowEnd = new Date(end);
  if (Number.isNaN(windowStart.getTime()) || Number.isNaN(windowEnd.getTime()) || windowEnd <= windowStart) {
    throw Object.assign(new Error('A janela de término deve ser posterior ao início'),{statusCode:400});
  }
  if (windowEnd.getTime() - windowStart.getTime() > 7 * 86400000) throw Object.assign(new Error('A janela não pode ultrapassar sete dias'),{statusCode:400});
  return { start:windowStart, end:windowEnd };
}

export async function nextChangeNumber() {
  const latest = await prisma.changeRequest.findFirst({orderBy:{number:'desc'},select:{number:true}});
  return (latest?.number || 0) + 1;
}

export async function recordChangeEvent(changeRequestId, action, actor, details = null) {
  return prisma.changeRequestEvent.create({data:{changeRequestId,action,actor,details:details ? JSON.stringify(details).slice(0,4000) : null}});
}

export const changeInclude = {
  task:{select:{id:true,taskNumber:true,status:true}},
  devices:{include:{device:{select:{id:true,name:true,hostname:true,type:true,group:true}}}},
  events:{orderBy:{createdAt:'desc'},take:100},
};

export async function prepareChange(change, actor) {
  const results = [];
  for (const item of change.devices) {
    const backup = await runDeviceBackup(item.deviceId,{type:'pre_change',username:actor});
    await prisma.changeRequestDevice.update({where:{id:item.id},data:{beforeBackupId:backup.id}});
    results.push({deviceId:item.deviceId,backupId:backup.id,sha256:backup.sha256});
  }
  await recordChangeEvent(change.id,'pre_change_backup',actor,{devices:results});
  return results;
}

export async function validateExecutedChange(change, actor) {
  const results = [];
  for (const item of change.devices) {
    let afterBackup;
    let scan;
    let status = 'passed';
    let detail = '';
    try {
      afterBackup = await runDeviceBackup(item.deviceId,{type:'post_change',username:actor});
      scan = await runComplianceScan(item.deviceId,{type:'change_validation',username:actor});
      const minimum = (await prisma.compliancePolicy.findUnique({where:{deviceId:item.deviceId}}))?.minimumScore || 80;
      status = (scan.score || 0) >= minimum && scan.regressions === 0 ? 'passed' : 'failed';
      detail = `Compliance ${scan.score}% (meta ${minimum}%), ${scan.regressions} regressão(ões).`;
    } catch (error) {
      status = 'failed';
      detail = error.message;
    }
    await prisma.changeRequestDevice.update({where:{id:item.id},data:{afterBackupId:afterBackup?.id||null,complianceScanId:scan?.id||null,validationStatus:status,validationDetail:detail.slice(0,2000)}});
    results.push({deviceId:item.deviceId,status,detail,afterBackupId:afterBackup?.id,complianceScanId:scan?.id});
  }
  const passed = results.every(item=>item.status==='passed');
  const summary = results.map(item=>`${item.status==='passed'?'OK':'FALHA'} ${item.deviceId}: ${item.detail}`).join('\n');
  await prisma.changeRequest.update({where:{id:change.id},data:{status:passed?'completed':'failed_validation',completedAt:passed?new Date():null,validationSummary:summary}});
  await recordChangeEvent(change.id,passed?'validation_passed':'validation_failed',actor,{results});
  return { passed, summary, results };
}

export async function createRollbackTasks(change, actor) {
  const taskIds = [];
  for (const item of change.devices) {
    const originalMessage = [
      `Rollback da mudança RFC-${String(change.number).padStart(5,'0')}: ${change.title}.`,
      `Equipamento: ${item.device.name} (${item.device.hostname}).`,
      `Backup anterior: ${item.beforeBackupId || 'não disponível'}.`,
      `Motivo: ${change.validationSummary || 'solicitado pelo administrador'}.`,
      `Plano de rollback:\n${change.rollbackPlan}`,
      'Validar o estado atual e exigir aprovação administrativa antes de qualquer comando.',
    ].join('\n\n');
    let task = await createTask({source:'change_management',workType:'configuration',deviceId:item.deviceId,priority:'critical',originalMessage,incident:{incidentKey:`change-rollback:${change.id}:${item.deviceId}`,incidentOpenedAt:new Date(),lastSeenAt:new Date()}});
    const needsPlanning = remediationNeedsPlanning(change.rollbackPlan);
    task = await updateTask(task.id,{status:needsPlanning?'pending':'awaiting_approval',diagnosis:`Rollback solicitado para RFC-${change.number}.`,proposedSolution:needsPlanning?null:change.rollbackPlan,agentUsed:item.device.type});
    await addTaskMessage(task.id,'system',needsPlanning?'O especialista deve preparar o rollback usando o backup anterior.':'Plano de rollback aguardando aprovação explícita.');
    taskIds.push(task.id);
  }
  await prisma.changeRequest.update({where:{id:change.id},data:{status:'rollback_requested',rollbackTaskId:JSON.stringify(taskIds)}});
  await recordChangeEvent(change.id,'rollback_requested',actor,{taskIds});
  return taskIds;
}
