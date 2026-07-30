import { Router } from 'express';
import * as taskService from '../services/task.service.js';
import prisma from '../database/client.js';
import { createSpecialistAgents } from '../vendors/registry.js';
import { buildSlaFields } from '../services/sla.service.js';
import { notifyTask } from '../services/notification.service.js';
import { configurationPlanningInstruction, specialistResultNeedsApproval } from '../services/agent-approval-policy.service.js';
import { logAudit } from '../services/audit.service.js';
import { runComplianceScan } from '../services/compliance.service.js';
import { recommendRunbooksForTask } from '../services/incident-runbook.service.js';
import { createSimulation, executeRunbook, publicExecution, renderRunbook, runbookInputHash } from '../services/runbook.service.js';

const router = Router();
const specialistAgents = createSpecialistAgents();
router.param('id',async(req,res,next,id)=>{try{if(!req.user.tenantId)return next();const task=await prisma.task.findFirst({where:{id,tenantId:req.user.tenantId},select:{id:true}});return task?next():res.status(404).json({success:false,error:'Task não encontrada'});}catch(error){next(error);}});

async function validateComplianceRemediation(task, actor, io) {
  if (!task.deviceId || !String(task.incidentKey || '').startsWith('compliance-remediation:')) return null;
  const ruleKey = String(task.incidentKey).split(':').slice(2).join(':');
  const scan = await runComplianceScan(task.deviceId,{type:'post_remediation',username:actor,validationTaskId:task.id});
  const finding = scan.findings.find(item=>item.ruleKey===ruleKey);
  const passed = finding && ['compliant','excepted'].includes(finding.status);
  const note = passed
    ? `Validação automática aprovada. O controle ${ruleKey} está conforme na verificação ${scan.id}; configuração SHA-256 ${scan.configurationSha256}.`
    : `Validação automática não confirmou a correção do controle ${ruleKey}. A Task permanece em atendimento. Verificação ${scan.id}; evidência: ${finding?.evidence || 'controle não localizado'}.`;
  const updated = await taskService.updateTask(task.id,passed
    ? {status:'validated',validatedAt:new Date(),resolutionSummary:note}
    : {status:'in_progress',resolvedAt:null,validatedAt:null,resolutionSummary:note});
  await taskService.addTaskMessage(task.id,'system',note);
  await notifyTask(updated,passed?'validated':'reopened',{message:note,io});
  await logAudit({username:actor,displayName:actor,role:'admin',action:'validate_remediation',resource:'task',resourceId:task.id,status:passed?'success':'failure',details:{taskNumber:task.taskNumber,scanId:scan.id,ruleKey,passed,configurationSha256:scan.configurationSha256}});
  return updated;
}

const TRANSITIONS = {
  acknowledge: { from: ['pending', 'failed'], to: 'in_progress' },
  resolve: { from: ['pending', 'in_progress', 'diagnosing', 'awaiting_approval', 'executing', 'failed'], to: 'resolved' },
  validate: { from: ['resolved', 'completed'], to: 'validated' },
  close: { from: ['resolved', 'completed', 'validated'], to: 'closed' },
  reopen: { from: ['resolved', 'completed', 'validated', 'closed', 'cancelled', 'failed'], to: 'pending' },
  cancel: { from: ['pending', 'in_progress', 'diagnosing', 'awaiting_approval', 'failed'], to: 'cancelled' },
};

router.post('/:id/workflow', async (req, res, next) => {
  try {
    const task = await taskService.getTaskById(req.params.id);
    if (!task) return res.status(404).json({ success: false, error: 'Task não encontrada' });
    const action = String(req.body.action || '');
    const actor = String(req.user?.name || req.user?.username || 'Sistema').trim().slice(0, 100);
    const note = String(req.body.note || '').trim().slice(0, 2000);

    if (action === 'assign') {
      const assignedTo = String(req.body.assignedTo || '').trim().slice(0, 100);
      if (!assignedTo) return res.status(400).json({ success: false, error: 'Informe o responsável' });
      const dueAt = req.body.dueAt ? new Date(req.body.dueAt) : null;
      if (dueAt && Number.isNaN(dueAt.getTime())) return res.status(400).json({ success: false, error: 'Prazo inválido' });
      const updated = await taskService.updateTask(task.id, { assignedTo, dueAt });
      await taskService.addTaskMessage(task.id, 'system', `${actor} atribuiu a Task para ${assignedTo}${dueAt ? ` com prazo até ${dueAt.toLocaleString('pt-BR')}` : ''}.${note ? ` Observação: ${note}` : ''}`);
      return res.json({ success: true, data: updated });
    }

    if (action === 'comment') {
      if (!note) return res.status(400).json({ success: false, error: 'Escreva um comentário' });
      await taskService.addTaskMessage(task.id, 'user', `${actor}: ${note}`);
      return res.json({ success: true, data: await taskService.getTaskById(task.id) });
    }

    const transition = TRANSITIONS[action];
    if (!transition) return res.status(400).json({ success: false, error: 'Ação de workflow inválida' });
    if (!transition.from.includes(task.status)) {
      return res.status(409).json({ success: false, error: `Não é possível executar "${action}" no estado atual (${task.status})` });
    }

    const now = new Date();
    const data = { status: transition.to };
    if (action === 'acknowledge') {
      data.acknowledgedAt = now;
      if (!task.assignedTo) data.assignedTo = actor;
    }
    if (action === 'resolve') {
      if (!note) return res.status(400).json({ success: false, error: 'Informe como o incidente foi resolvido' });
      data.resolvedAt = now;
      data.resolutionSummary = note;
      data.resolutionType = req.body.resolutionType === 'agent' ? 'agent' : 'manual';
      data.executionResult = note;
    }
    if (action === 'validate') data.validatedAt = now;
    if (action === 'close') data.closedAt = now;
    if (action === 'reopen') Object.assign(data, await buildSlaFields(task.priority, now), { resolvedAt: null, validatedAt: null, closedAt: null, resolutionSummary: null, resolutionType: null, adminResponse: null, acknowledgedAt: null, slaWarningSentAt: null, slaAckBreachedAt: null, slaResolveBreachedAt: null });

    const labels = { acknowledge: 'reconheceu e iniciou o atendimento', resolve: 'marcou como resolvida', validate: 'validou a resolução', close: 'encerrou', reopen: 'reabriu', cancel: 'cancelou' };
    const updated = await taskService.updateTask(task.id, data);
    await taskService.addTaskMessage(task.id, 'system', `${actor} ${labels[action]} a Task.${note && action !== 'resolve' ? ` Observação: ${note}` : ''}`);
    const notificationEvents = { acknowledge: 'acknowledged', resolve: 'resolved', validate: 'validated', close: 'closed', reopen: 'reopened' };
    if (notificationEvents[action]) await notifyTask(updated, notificationEvents[action], { message: note, io: req.app.get('io') });
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
});

router.get('/', async (req, res, next) => {
  try {
    const { status, source, priority, sla, limit } = req.query;
    const tasks = await taskService.getAllTasks({
      status, source, priority, sla, limit: limit ? parseInt(limit) : 50,tenantId:req.user.tenantId,
    });
    res.json({ success: true, data: tasks });
  } catch (err) { next(err); }
});

router.get('/stats', async (req, res, next) => {
  try {
    const stats = await taskService.getTaskStats(req.user.tenantId);
    res.json({ success: true, data: stats });
  } catch (err) { next(err); }
});

router.post('/:id/approval', async(req,res,next)=>{
  let task;
  try{
    if(req.user.role!=='admin')return res.status(403).json({success:false,error:'Somente administradores podem aprovar configurações'});
    task=await taskService.getTaskById(req.params.id);
    if(!task)return res.status(404).json({success:false,error:'Task não encontrada'});
    if(task.status!=='awaiting_approval')return res.status(409).json({success:false,error:'A Task não está aguardando aprovação'});
    const approved=req.body.approved===true;
    const actor=req.user.name||req.user.username;
    if(!approved){
      const updated=await taskService.updateTask(task.id,{status:'cancelled',adminResponse:'no'});
      await taskService.addTaskMessage(task.id,'user',`${actor} rejeitou a correção. Nenhum comando foi executado.`);
      await logAudit({userId:req.user.id||req.user.sub,username:req.user.username,displayName:req.user.name,role:req.user.role,action:'reject',resource:'task',resourceId:task.id,status:'success',details:{taskNumber:task.taskNumber}});
      return res.json({success:true,data:updated,message:'Correção rejeitada'});
    }
    if(!task.deviceId||!task.agentUsed||!task.proposedSolution)return res.status(400).json({success:false,error:'A Task não possui equipamento, especialista ou plano completo'});
    const agent=specialistAgents[task.agentUsed];
    if(!agent)return res.status(400).json({success:false,error:'Especialista indisponível para este equipamento'});
    await taskService.updateTask(task.id,{status:'executing',adminResponse:'yes'});
    await taskService.addTaskMessage(task.id,'user',`${actor} aprovou explicitamente a correção.`);
    await logAudit({userId:req.user.id||req.user.sub,username:req.user.username,displayName:req.user.name,role:req.user.role,action:'approve',resource:'task',resourceId:task.id,status:'success',details:{taskNumber:task.taskNumber,agent:task.agentUsed}});
    const execution=await agent.executeSolution(task.deviceId,task.device?.name||'Dispositivo',task.proposedSolution,task.taskNumber);
    let updated=await taskService.updateTask(task.id,{status:'resolved',executionResult:execution.text,resolutionSummary:execution.text,resolutionType:'agent',resolvedAt:new Date()});
    await taskService.addTaskMessage(task.id,'agent',execution.text,task.agentUsed);
    await notifyTask(updated,'resolved',{message:'Correção de compliance executada após aprovação administrativa.',io:req.app.get('io')});
    await logAudit({userId:req.user.id||req.user.sub,username:req.user.username,displayName:req.user.name,role:req.user.role,action:'agent_execute',resource:'task',resourceId:task.id,status:'success',details:{taskNumber:task.taskNumber,agent:task.agentUsed}});
    updated = await validateComplianceRemediation({...task,...updated},actor,req.app.get('io')) || updated;
    res.json({success:true,data:updated,message:updated.status==='validated'?'Correção executada e validada no equipamento':'Correção executada; validação requer nova análise'});
  }catch(error){
    if(task)await taskService.updateTask(task.id,{status:'failed',executionResult:`Falha na execução aprovada: ${error.message}`}).catch(()=>{});
    next(error);
  }
});

router.post('/:id/reprocess', async (req, res, next) => {
  try {
    const task = await taskService.getTaskById(req.params.id);
    if (!task) return res.status(404).json({ success: false, error: 'Task não encontrada' });
    if (['executing', 'diagnosing'].includes(task.status)) {
      return res.status(409).json({ success: false, error: 'A Task já está sendo processada' });
    }

    const deviceId = req.body.deviceId || task.deviceId;
    if (!deviceId) return res.status(400).json({ success: false, error: 'Selecione um equipamento para reprocessar' });
    const device = await prisma.device.findUnique({ where: { id: deviceId } });
    if (!device || !device.isActive) return res.status(404).json({ success: false, error: 'Equipamento não encontrado ou inativo' });

    const agent = specialistAgents[device.type] || null;
    if (!agent) return res.status(400).json({ success: false, error: 'Tipo de equipamento sem agente disponível' });

    await taskService.updateTask(task.id, { status: 'diagnosing', deviceId, agentUsed: device.type, adminResponse: null });
    await taskService.addTaskMessage(task.id, 'system', `Reprocessamento manual iniciado para ${device.name}`);

    const request = `${task.originalMessage}${configurationPlanningInstruction(task.workType, task.taskNumber)}`;
    const result = await agent.diagnose(device.id, device.name, request, task.taskNumber);
    const needsApproval = specialistResultNeedsApproval(task.workType, result.text);
    const updated = await taskService.updateTask(task.id, {
      status: needsApproval ? 'awaiting_approval' : 'resolved',
      diagnosis: result.text,
      proposedSolution: needsApproval ? result.text : null,
      executionResult: needsApproval ? null : result.text,
    });
    await taskService.addTaskMessage(task.id, 'agent', result.text, device.type);
    res.json({ success: true, data: updated });
  } catch (err) {
    try { await taskService.updateTask(req.params.id, { status: 'failed', diagnosis: `Erro no reprocessamento: ${err.message}` }); } catch {}
    next(err);
  }
});

router.post('/:id/complete', async (req, res, next) => {
  try {
    const task = await taskService.getTaskById(req.params.id);
    if (!task) return res.status(404).json({ success: false, error: 'Task não encontrada' });
    if (['executing', 'diagnosing'].includes(task.status)) return res.status(409).json({ success: false, error: 'A Task está em processamento' });
    const note = String(req.body.note || 'Concluída manualmente pelo administrador').slice(0, 1000);
    let updated = await taskService.updateTask(task.id, { status: 'resolved', executionResult: note, resolutionSummary: note, resolutionType: 'manual', resolvedAt: new Date(), adminResponse: 'manual' });
    await taskService.addTaskMessage(task.id, 'user', note);
    await notifyTask(updated, 'resolved', { message: note, io: req.app.get('io') });
    updated = await validateComplianceRemediation({...task,...updated},req.user?.username || 'admin',req.app.get('io')) || updated;
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
});

router.get('/:id/runbooks',async(req,res,next)=>{
  try{
    const task=await taskService.getTaskById(req.params.id);
    if(!task)return res.status(404).json({success:false,error:'Task não encontrada'});
    const [suggestions,executions]=await Promise.all([
      recommendRunbooksForTask(task),
      prisma.runbookExecution.findMany({where:{taskId:task.id},include:{runbook:{select:{name:true,version:true}},device:{select:{name:true,type:true}}},orderBy:{createdAt:'desc'},take:20}),
    ]);
    res.json({success:true,data:{suggestions,executions:executions.map(publicExecution)}});
  }catch(error){next(error);}
});

router.post('/:id/runbooks/:runbookId/simulate',async(req,res,next)=>{
  try{
    if(!['admin','operator'].includes(req.user.role))return res.status(403).json({success:false,error:'Sem permissão para simular runbooks'});
    const task=await taskService.getTaskById(req.params.id);
    if(!task)return res.status(404).json({success:false,error:'Task não encontrada'});
    if(!task.deviceId||!task.device?.isActive)return res.status(409).json({success:false,error:'Vincule um equipamento ativo à Task antes da simulação'});
    const runbook=await prisma.runbook.findUnique({where:{id:req.params.runbookId}});
    if(!runbook||runbook.status!=='published')return res.status(404).json({success:false,error:'Runbook publicado não encontrado'});
    if(runbook.deviceType!=='any'&&runbook.deviceType!==task.device.type)return res.status(400).json({success:false,error:'Runbook incompatível com o equipamento da Task'});
    const definition={...runbook,variables:JSON.parse(runbook.variables||'[]'),steps:JSON.parse(runbook.steps||'[]')};
    const rendered=renderRunbook(definition,req.body.variables||{},task.device);
    const actor=req.user.name||req.user.username;
    const execution=await createSimulation({runbook,device:task.device,rendered,requestedBy:actor,taskId:task.id});
    const changeCount=rendered.steps.filter(step=>step.commandType==='change').length;
    await taskService.addTaskMessage(task.id,'system',`${actor} simulou o Runbook "${runbook.name}" v${runbook.version}: ${rendered.steps.length} etapa(s), ${changeCount} alteração(ões). Nenhum comando foi executado.`,'runbook');
    await logAudit({userId:req.user.id||req.user.sub,username:req.user.username,displayName:req.user.name,role:req.user.role,action:'simulate',resource:'task_runbook',resourceId:execution.id,status:'success',details:{taskNumber:task.taskNumber,runbookId:runbook.id,runbookVersion:runbook.version,deviceId:task.deviceId,changeCount}});
    res.json({success:true,data:publicExecution(execution),message:'Simulação vinculada à linha do tempo; nenhum comando foi executado'});
  }catch(error){next(error);}
});

router.post('/:id/runbooks/:runbookId/execute',async(req,res,next)=>{
  try{
    if(req.user.role!=='admin'||req.body.confirmed!==true)return res.status(403).json({success:false,error:'Execução exige administrador e confirmação explícita'});
    const task=await taskService.getTaskById(req.params.id);
    if(!task||!task.deviceId||!task.device?.isActive)return res.status(404).json({success:false,error:'Task com equipamento ativo não encontrada'});
    const runbook=await prisma.runbook.findUnique({where:{id:req.params.runbookId}});
    if(!runbook||runbook.status!=='published')return res.status(404).json({success:false,error:'Runbook publicado não encontrado'});
    if(runbook.deviceType!=='any'&&runbook.deviceType!==task.device.type)return res.status(400).json({success:false,error:'Runbook incompatível com o equipamento da Task'});
    const definition={...runbook,variables:JSON.parse(runbook.variables||'[]'),steps:JSON.parse(runbook.steps||'[]')};
    const rendered=renderRunbook(definition,req.body.variables||{},task.device);
    const inputHash=runbookInputHash(runbook.id,task.deviceId,rendered.variables);
    const simulation=await prisma.runbookExecution.findFirst({where:{taskId:task.id,runbookId:runbook.id,deviceId:task.deviceId,mode:'simulation',status:'completed',inputHash,createdAt:{gte:new Date(Date.now()-30*60_000)}},orderBy:{createdAt:'desc'}});
    if(!simulation)return res.status(409).json({success:false,error:'Simule estes mesmos valores nesta Task nos últimos 30 minutos antes de executar'});
    const actor=req.user.name||req.user.username;
    const execution=await executeRunbook({runbook,device:task.device,rendered,requestedBy:actor,approvedBy:actor,taskId:task.id});
    await taskService.addTaskMessage(task.id,'system',`${actor} executou o Runbook "${runbook.name}" v${runbook.version}. Resultado: ${execution.status==='completed'?'concluído':'falhou'}. O incidente permanece aberto até validação humana.`,'runbook');
    await logAudit({userId:req.user.id||req.user.sub,username:req.user.username,displayName:req.user.name,role:req.user.role,action:'execute',resource:'task_runbook',resourceId:execution.id,status:execution.status==='completed'?'success':'failure',details:{taskNumber:task.taskNumber,runbookId:runbook.id,runbookVersion:runbook.version,deviceId:task.deviceId}});
    res.json({success:true,data:publicExecution(execution),message:execution.status==='completed'?'Runbook executado; valide a recuperação antes de resolver a Task':'Runbook terminou com falha; revise as evidências'});
  }catch(error){next(error);}
});

router.get('/:id', async (req, res, next) => {
  try {
    const task = await taskService.getTaskById(req.params.id);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
    res.json({ success: true, data: task });
  } catch (err) { next(err); }
});

router.get('/number/:taskNumber', async (req, res, next) => {
  try {
    const task = await taskService.getTaskByNumber(parseInt(req.params.taskNumber));
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
    res.json({ success: true, data: task });
  } catch (err) { next(err); }
});

export default router;
