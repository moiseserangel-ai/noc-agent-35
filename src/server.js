import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import config from './config/index.js';
import logger from './utils/logger.js';
import { errorHandler, notFoundHandler } from './middleware/error.middleware.js';
import { authMiddleware, verifyToken, globalOnly, requireRoles, readOnlyForViewer } from './middleware/auth.middleware.js';

import authRoutes from './routes/auth.routes.js';
import deviceRoutes from './routes/device.routes.js';
import settingsRoutes from './routes/settings.routes.js';
import integrationRoutes from './routes/integration.routes.js';
import taskRoutes from './routes/task.routes.js';
import chatRoutes from './routes/chat.routes.js';
import webhookRoutes from './routes/webhook.routes.js';
import vpnRoutes from './routes/vpn.routes.js';
import userRoutes from './routes/user.routes.js';
import auditRoutes from './routes/audit.routes.js';
import reportRoutes from './routes/report.routes.js';
import backupRoutes from './routes/backup.routes.js';
import aiUsageRoutes from './routes/ai-usage.routes.js';
import brandingRoutes from './routes/branding.routes.js';
import cliRoutes from './routes/cli.routes.js';
import knowledgeRoutes from './routes/knowledge.routes.js';
import deviceBackupRoutes from './routes/device-backup.routes.js';
import complianceRoutes from './routes/compliance.routes.js';
import changeRequestRoutes from './routes/change-request.routes.js';
import discoveryRoutes from './routes/discovery.routes.js';
import capacityRoutes from './routes/capacity.routes.js';
import topologyRoutes from './routes/topology.routes.js';
import runbookRoutes from './routes/runbook.routes.js';
import notificationRoutes from './routes/notification.routes.js';
import onCallRoutes from './routes/on-call.routes.js';
import statusAdminRoutes,{publicStatusRouter} from './routes/status-page.routes.js';
import tenantRoutes from './routes/tenant.routes.js';
import cmdbRoutes from './routes/cmdb.routes.js';
import vulnerabilityRoutes from './routes/vulnerability.routes.js';
import lifecycleRoutes from './routes/lifecycle.routes.js';
import supplierRoutes from './routes/supplier.routes.js';
import commercialContractRoutes from './routes/commercial-contract.routes.js';
import softwareLicenseRoutes from './routes/software-license.routes.js';
import commercialCostRoutes from './routes/commercial-cost.routes.js';
import commercialDashboardRoutes from './routes/commercial-dashboard.routes.js';
import { auditMutation } from './middleware/audit.middleware.js';
import { logAudit } from './services/audit.service.js';
import { inferWorkType } from './services/work-type.service.js';
import { registerInteractiveCli } from './services/interactive-cli.service.js';
import { configurationPlanningInstruction, specialistResultNeedsApproval } from './services/agent-approval-policy.service.js';
import { resumeKnowledgeImportJobs } from './services/knowledge.service.js';
import { runDeviceBackupScheduler } from './services/device-backup.service.js';
import { runComplianceEscalations, runComplianceExceptionReminders, runComplianceScheduler } from './services/compliance.service.js';
import { runCapacityScheduler } from './services/capacity.service.js';
import { runRunbookScheduleScheduler } from './services/runbook-schedule.service.js';
import { resumeInterruptedBatches } from './services/runbook-batch.service.js';
import { syncStatusServices } from './services/status-page.service.js';
import { runMonthlyReportScheduler } from './services/monthly-report.service.js';
import { runCmdbInventoryScheduler } from './services/cmdb-inventory.service.js';
import { runCmdbLifecycleMonitor } from './services/cmdb-lifecycle.service.js';
import { runVulnerabilityScheduler } from './services/vulnerability.service.js';
import { runCommercialExpiryScheduler } from './services/commercial-expiry.service.js';

import prisma from './database/client.js';
import SupportAgent from './agents/support-agent.js';
import { createSpecialistAgents, getDeviceTypeLabel } from './vendors/registry.js';
import * as taskService from './services/task.service.js';
import { runSlaMonitor } from './services/sla.service.js';
import { notifyTask, runCriticalEscalations } from './services/notification.service.js';
import { runAutomaticBackup } from './services/backup.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const httpServer = createServer(app);

const originAllowed = (origin) => !origin || config.allowedOrigins.length === 0 || config.allowedOrigins.includes(origin);
const io = new Server(httpServer, { cors: { origin: (origin, cb) => cb(originAllowed(origin) ? null : new Error('Origin denied'), originAllowed(origin)), methods: ['GET', 'POST'] } });

// Middleware
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.set('trust proxy', 1);
app.use(cors({ origin: (origin, cb) => cb(originAllowed(origin) ? null : new Error('Origin denied'), originAllowed(origin)), credentials: false }));
app.use(express.json({ limit: '10mb' }));

// Serve frontend static files
app.use(express.static(join(__dirname, '..', 'frontend', 'dist')));

// Public routes
app.use('/api/auth', authRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/branding', brandingRoutes);
app.use('/api/public/status', publicStatusRouter);

// Protected routes
app.use('/api/devices', authMiddleware, auditMutation, (req, res, next) => ['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.user.role === 'admin' ? next() : res.status(403).json({ success: false, error: 'Somente administradores podem alterar equipamentos' }), deviceRoutes);
app.use('/api/settings', authMiddleware,globalOnly, requireRoles('admin'), auditMutation, settingsRoutes);
app.use('/api/integrations', authMiddleware,globalOnly, requireRoles('admin'), auditMutation, integrationRoutes);
app.use('/api/tasks', authMiddleware, readOnlyForViewer, auditMutation, taskRoutes);
app.use('/api/chat', authMiddleware,globalOnly, requireRoles('admin', 'operator'), auditMutation, chatRoutes);
app.use('/api/vpn', authMiddleware,globalOnly, requireRoles('admin'), auditMutation, vpnRoutes);
app.use('/api/users', authMiddleware,globalOnly, requireRoles('admin'), auditMutation, userRoutes);
app.use('/api/tenants',authMiddleware,globalOnly,requireRoles('admin'),auditMutation,tenantRoutes);
app.use('/api/audit', authMiddleware,globalOnly, requireRoles('admin'), auditRoutes);
app.use('/api/reports', authMiddleware, reportRoutes);
app.use('/api/backups', authMiddleware,globalOnly, requireRoles('admin'), backupRoutes);
app.use('/api/ai-usage', authMiddleware,globalOnly, requireRoles('admin'), auditMutation, aiUsageRoutes);
app.use('/api/cli', authMiddleware,globalOnly, auditMutation, cliRoutes);
app.use('/api/knowledge', authMiddleware,globalOnly, requireRoles('admin'), auditMutation, knowledgeRoutes);
app.use('/api/device-backups', authMiddleware,globalOnly, requireRoles('admin'), auditMutation, deviceBackupRoutes);
app.use('/api/compliance', authMiddleware,globalOnly, requireRoles('admin'), auditMutation, complianceRoutes);
app.use('/api/changes', authMiddleware,globalOnly, requireRoles('admin', 'operator'), auditMutation, changeRequestRoutes);
app.use('/api/discovery', authMiddleware,globalOnly, requireRoles('admin'), auditMutation, discoveryRoutes);
app.use('/api/capacity', authMiddleware,globalOnly, auditMutation, capacityRoutes);
app.use('/api/topology', authMiddleware,globalOnly, auditMutation, topologyRoutes);
app.use('/api/runbooks', authMiddleware,globalOnly, requireRoles('admin', 'operator'), auditMutation, runbookRoutes);
app.use('/api/notifications', authMiddleware,globalOnly, auditMutation, notificationRoutes);
app.use('/api/on-call', authMiddleware,globalOnly, requireRoles('admin'), auditMutation, onCallRoutes);
app.use('/api/status-page', authMiddleware,globalOnly, requireRoles('admin'), auditMutation, statusAdminRoutes);
app.use('/api/cmdb',authMiddleware,globalOnly,requireRoles('admin'),auditMutation,cmdbRoutes);
app.use('/api/vulnerabilities',authMiddleware,globalOnly,requireRoles('admin'),auditMutation,vulnerabilityRoutes);
app.use('/api/lifecycle',authMiddleware,globalOnly,requireRoles('admin'),auditMutation,lifecycleRoutes);
app.use('/api/suppliers',authMiddleware,globalOnly,requireRoles('admin'),auditMutation,supplierRoutes);
app.use('/api/commercial-contracts',authMiddleware,globalOnly,requireRoles('admin'),auditMutation,commercialContractRoutes);
app.use('/api/software-licenses',authMiddleware,globalOnly,requireRoles('admin'),auditMutation,softwareLicenseRoutes);
app.use('/api/commercial-costs',authMiddleware,globalOnly,requireRoles('admin'),commercialCostRoutes);
app.use('/api/commercial-dashboard',authMiddleware,globalOnly,requireRoles('admin'),commercialDashboardRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// Socket.IO for real-time dashboard chat
const agents = {
  support: new SupportAgent(),
  ...createSpecialistAgents(),
};

async function getSessionHistory(sessionId, currentMessageId) {
  const rows = await prisma.chatMessage.findMany({
    where: { sessionId, ...(currentMessageId && { id: { not: currentMessageId } }) },
    orderBy: { createdAt: 'desc' },
    take: 16,
    select: { role: true, content: true },
  });
  const chronological = rows.reverse();
  const selected = [];
  let characters = 0;
  for (let index = chronological.length - 1; index >= 0; index -= 1) {
    const item = chronological[index];
    const content = String(item.content || '').slice(0, 4000);
    if (characters + content.length > 12000 && selected.length) break;
    selected.unshift({ role: item.role === 'assistant' ? 'assistant' : 'user', content });
    characters += content.length;
  }
  return selected;
}

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) throw new Error('Token ausente');
    const decoded = verifyToken(token);
    const [user,session]=await Promise.all([prisma.user.findUnique({where:{id:decoded.sub}}),prisma.authSession.findUnique({where:{id:decoded.jti}})]);
    if(!user?.isActive||!session||session.revokedAt||session.expiresAt<=new Date()||decoded.sessionVersion!==user.sessionVersion)throw new Error('Sessão inválida');
    if(session.userId!==user.id)throw new Error('Sessão inválida');
    if(user.tenantId&&!await prisma.tenant.findFirst({where:{id:user.tenantId,isActive:true},select:{id:true}}))throw new Error('Cliente inativo');
    socket.user = { ...decoded,name:user.name,username:user.username,role:user.role,tenantId:user.tenantId };
    next();
  } catch {
    next(new Error('Não autorizado'));
  }
});

io.on('connection', (socket) => {
  logger.info(`Dashboard client connected: ${socket.id}`);
  registerInteractiveCli(socket);
  const chatControllers=new Map();
  socket.on('chat:cancel',({sessionId})=>{const controller=chatControllers.get(sessionId);if(controller){controller.abort();chatControllers.delete(sessionId);socket.emit('chat:cancelled',{sessionId});}});

  socket.on('chat:message', async ({ sessionId, message, agentType = 'support', deviceId = null }) => {
    let responseController=null;
    try {
      if (socket.user.tenantId) throw new Error('Chat com agentes é restrito à equipe global do NOC');
      if (!['admin', 'operator'].includes(socket.user.role)) throw new Error('Sem permissão para usar agentes');
      if (typeof sessionId !== 'string' || typeof message !== 'string' || message.length > 4000) throw new Error('Mensagem inválida');
      const ownedSession = await prisma.chatSession.findUnique({ where: { id: sessionId } });
      if (!ownedSession) throw new Error('Sessão inválida');
      const agent = agents[agentType];
      if (!agent) {
        socket.emit('chat:error', { error: `Agent "${agentType}" not found` });
        return;
      }
      const selectedDevice=deviceId?await prisma.device.findFirst({where:{id:String(deviceId),isActive:true},select:{id:true,type:true}}):null;
      if(deviceId&&!selectedDevice)throw new Error('Equipamento fixado não encontrado ou inativo');
      const agentMessage=selectedDevice?`[EQUIPAMENTO FIXADO PELO USUÁRIO]\nID interno: ${selectedDevice.id}\nTipo: ${selectedDevice.type}\nUse somente o ID interno nas ferramentas; não solicite nem exponha Host/IP ou credenciais.\n\nSolicitação: ${message}`:message;

      // Save user message
      const savedUserMessage = await prisma.chatMessage.create({
        data: { sessionId, role: 'user', content: message },
      });
      const history = await getSessionHistory(sessionId, savedUserMessage.id);

      // Process dashboard approvals before asking the support model to classify them.
      // An explicit task reference is accepted, but in a single dashboard chat the
      // administrator may simply answer SIM or NAO to the latest pending task.
      const approvalMatch = message.trim().match(/^(?:(sim|s|yes|confirmo|aprovar|aplicar)|(n[aã]o|n|no|cancelar|rejeitar))(?:\s+#?TASK-?(\d+))?[.!]?$/i);
      if (approvalMatch) {
        const approved = Boolean(approvalMatch[1]);
        const explicitNumber = approvalMatch[3] ? Number(approvalMatch[3]) : null;
        const pendingTask = explicitNumber
          ? await taskService.getTaskByNumber(explicitNumber)
          : await prisma.task.findFirst({
              where: { source: `dashboard:${sessionId}`, status: 'awaiting_approval' },
              include: { device: true },
              orderBy: { createdAt: 'desc' },
            });

        if (!pendingTask || pendingTask.status !== 'awaiting_approval') {
          const text = 'Não há nenhuma alteração aguardando aprovação neste chat.';
          await prisma.chatMessage.create({ data: { sessionId, role: 'assistant', content: text, agentUsed: 'support' } });
          socket.emit('chat:chunk', { text });
          socket.emit('chat:complete', { text, agentUsed: 'support', toolsUsed: [] });
          return;
        }

        const task = await taskService.processApproval(pendingTask.taskNumber, approved);
        await logAudit({ userId: socket.user.sub, username: socket.user.username, displayName: socket.user.name, role: socket.user.role, action: approved ? 'approve' : 'reject', resource: 'task', resourceId: task.id, status: 'success', details: { taskNumber: task.taskNumber } });
        if (!approved) {
          const text = `❌ Alteração #TASK-${task.taskNumber} cancelada. Nenhuma ação foi executada.`;
          await taskService.addTaskMessage(task.id, 'user', 'Solução REJEITADA pelo administrador no dashboard');
          await prisma.chatMessage.create({ data: { sessionId, role: 'assistant', content: text, agentUsed: task.agentUsed } });
          socket.emit('chat:chunk', { text });
          socket.emit('chat:complete', { text, agentUsed: task.agentUsed, toolsUsed: [] });
          return;
        }

        const specialistAgent = agents[task.agentUsed];
        if (!specialistAgent || !task.deviceId) throw new Error('Especialista ou dispositivo da alteração não está disponível');
        socket.emit('chat:chunk', { text: `✅ Alteração #TASK-${task.taskNumber} aprovada. Executando...\n\n` });
        socket.emit('chat:typing', { agentType: task.agentUsed });
        const execution = await specialistAgent.executeSolution(
          task.deviceId, task.device?.name || 'Dispositivo', task.proposedSolution, task.taskNumber
        );
        const resolvedTask = await taskService.updateTask(task.id, { status: 'resolved', executionResult: execution.text, resolutionSummary: execution.text, resolutionType: 'agent', resolvedAt: new Date() });
        await taskService.addTaskMessage(task.id, 'agent', execution.text, task.agentUsed);
        await notifyTask(resolvedTask, 'resolved', { message: 'Solução executada pelo agente.', io });
        await logAudit({ userId: socket.user.sub, username: socket.user.username, displayName: socket.user.name, role: socket.user.role, action: 'agent_execute', resource: 'task', resourceId: task.id, status: 'success', details: { taskNumber: task.taskNumber, agent: task.agentUsed } });
        await prisma.chatMessage.create({ data: { sessionId, role: 'assistant', content: execution.text, agentUsed: task.agentUsed } });
        socket.emit('chat:chunk', { text: execution.text });
        socket.emit('chat:complete', { text: execution.text, agentUsed: task.agentUsed, toolsUsed: execution.toolsUsed || [] });
        return;
      }

      // Update session title if first message
      const session = await prisma.chatSession.findUnique({
        where: { id: sessionId },
        include: { messages: true },
      });
      if (session && session.messages.length <= 1) {
        await prisma.chatSession.update({
          where: { id: sessionId },
          data: { title: message.substring(0, 80) },
        });
      }

      // Run agent with streaming
      chatControllers.get(sessionId)?.abort();
      responseController=new AbortController();chatControllers.set(sessionId,responseController);
      socket.emit('chat:typing', { agentType });
      
      const result = await agent.runStreaming(agentMessage, (chunk) => {
        // If it's SupportAgent, we hide the text stream to prevent raw JSON from showing up,
        // but we still emit tool events.
        if (agentType !== 'support' && chunk.type === 'text') {
          socket.emit('chat:chunk', { text: chunk.text });
        } else if (chunk.type === 'tool_start') {
          socket.emit('chat:tool', { status: 'start', tool: chunk.tool, input: chunk.input });
        } else if (chunk.type === 'tool_result') {
          socket.emit('chat:tool', { status: 'result', tool: chunk.tool, output: chunk.output });
        }
      }, { history, tenantId: socket.user.tenantId || undefined, signal:responseController.signal });

      // Handle automatic routing if Support Agent was used
      if (agentType === 'support') {
        const jsonMatch = result.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const classification = JSON.parse(jsonMatch[0]);
            
            // Emit the natural part of the text (if any) before the JSON
            const naturalText = result.text.replace(/```json\s*\{[\s\S]*\}\s*```|\{[\s\S]*\}/, '').trim();
            if (naturalText) {
              socket.emit('chat:chunk', { text: naturalText });
            }

            if (classification.action === 'route_to_specialist') {
              const { deviceId, deviceType, deviceName, originalRequest } = classification;
              const specialistAgent = agents[deviceType];
              
              if (specialistAgent) {
                const dashboardTask = await taskService.createTask({
                  source: `dashboard:${sessionId}`,
                  originalMessage: originalRequest,
                  deviceId,
                  priority: classification.priority || 'medium',
                  workType: inferWorkType(originalRequest, 'dashboard', classification.requestType),
                });
                const taskNum = dashboardTask.taskNumber;
                await taskService.updateTask(dashboardTask.id, { status: 'diagnosing', agentUsed: deviceType });
                const prompt = `Você recebeu uma solicitação do NOC.

**Dispositivo:** ${deviceName} (ID: ${deviceId})
**Tipo:** ${getDeviceTypeLabel(deviceType)}
**Task:** #TASK-${taskNum}
**Solicitação:** ${originalRequest}

Acesse o equipamento, analise e atenda à solicitação da forma mais autônoma possível. Use o deviceId "${deviceId}" em todas as chamadas de tools.
${configurationPlanningInstruction(dashboardTask.workType, taskNum)}`;

                socket.emit('chat:chunk', { text: `\n\n🔄 **Encaminhando para especialista em ${deviceType}...**\n\n` });
                socket.emit('chat:typing', { agentType: deviceType });

                const specialistResult = await specialistAgent.runStreaming(prompt, (chunk) => {
                  if (chunk.type === 'text') {
                    socket.emit('chat:chunk', { text: chunk.text });
                  } else if (chunk.type === 'tool_start') {
                    socket.emit('chat:tool', { status: 'start', tool: chunk.tool, input: chunk.input });
                  } else if (chunk.type === 'tool_result') {
                    socket.emit('chat:tool', { status: 'result', tool: chunk.tool, output: chunk.output });
                  }
                }, { history, tenantId: dashboardTask.tenantId || socket.user.tenantId || undefined, signal:responseController.signal });

                result.text += `\n\n🔄 **Encaminhando para especialista em ${deviceType}...**\n\n${specialistResult.text}`;
                result.toolsUsed.push(...specialistResult.toolsUsed);
                result.agentUsed=deviceType;result.provider=specialistResult.provider;result.model=specialistResult.model;result.knowledgeSources=specialistResult.knowledgeSources;
                const needsApproval = specialistResultNeedsApproval(dashboardTask.workType, specialistResult.text);
                await taskService.updateTask(dashboardTask.id, {
                  status: needsApproval ? 'awaiting_approval' : 'resolved',
                  diagnosis: specialistResult.text,
                  proposedSolution: needsApproval ? specialistResult.text : null,
                  executionResult: needsApproval ? null : specialistResult.text,
                  resolutionSummary: needsApproval ? null : specialistResult.text,
                  resolutionType: needsApproval ? null : 'agent',
                  resolvedAt: needsApproval ? null : new Date(),
                });
                await taskService.addTaskMessage(dashboardTask.id, 'agent', specialistResult.text, deviceType);
              }
            } else if (classification.action === 'knowledge_answer') {
              const answer = classification.message || 'Não encontrei conteúdo suficiente na base de conhecimento para responder.';
              result.text = answer;
              socket.emit('chat:chunk', { text: answer });
            } else if (classification.action === 'unknown') {
              const answer = classification.message || 'Não consegui identificar o equipamento ou a ação desejada.';
              result.text = answer;
              socket.emit('chat:chunk', { text: answer });
            }
          } catch (e) {
            logger.warn(`Could not parse JSON for specialist routing: ${e.message}`);
          }
        } else {
          // If no JSON was found, just emit the whole text
          socket.emit('chat:chunk', { text: result.text });
        }
      }

      // Save assistant message
      const savedAssistantMessage=await prisma.chatMessage.create({
        data: {
          sessionId,
          role: 'assistant',
          content: result.text,
          agentUsed: result.agentUsed||agentType,
          provider: result.provider||null,
          model: result.model||null,
          knowledgeSources: result.knowledgeSources?.length?JSON.stringify(result.knowledgeSources):null,
          toolCalls: result.toolsUsed.length > 0 ? JSON.stringify(result.toolsUsed) : null,
        },
      });

      socket.emit('chat:complete', {
        text: result.text,
        agentUsed: result.agentUsed||agentType,
        provider: result.provider||null,
        model: result.model||null,
        knowledgeSources: result.knowledgeSources||[],
        messageId:savedAssistantMessage.id,
        toolsUsed: result.toolsUsed,
      });
    } catch (err) {
      logger.error(`Chat error: ${err.message}`);
      if(err.name==='AbortError')socket.emit('chat:cancelled',{sessionId});else socket.emit('chat:error', { error: err.message });
    } finally {
      if(responseController&&chatControllers.get(sessionId)===responseController)chatControllers.delete(sessionId);
    }
  });

  socket.on('disconnect', () => {
    logger.info(`Dashboard client disconnected: ${socket.id}`);
  });
});

// Make io available to webhook routes for real-time updates
app.set('io', io);

// SPA fallback
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return notFoundHandler(req, res);
  }
  res.sendFile(join(__dirname, '..', 'frontend', 'dist', 'index.html'));
});

app.use(errorHandler);

// Start server
httpServer.listen(config.port, config.host, () => {
  logger.info(`🚀 NOC Agent 35 running on http://${config.host}:${config.port}`);
  logger.info(`📊 Dashboard: http://localhost:${config.port}`);
  logger.info(`🔌 WebSocket: ws://localhost:${config.port}`);
  logger.info(`📱 WhatsApp webhook: POST /api/webhooks/evolution`);
  logger.info(`📊 Zabbix webhook: POST /api/webhooks/zabbix`);
});

resumeKnowledgeImportJobs().catch(err => logger.error(`Knowledge import recovery error: ${err.message}`));
resumeInterruptedBatches().catch(err=>logger.error(`Runbook batch recovery error: ${err.message}`));

const slaMonitor = setInterval(() => {
  runSlaMonitor(async (task, message, level) => {
    io.emit('task:sla', { taskId: task.id, taskNumber: task.taskNumber, message });
    const event = level >= 3 ? 'sla_resolution_breached' : level >= 2 ? 'sla_ack_breached' : 'sla_warning';
    await notifyTask(task, event, { message, io });
  }).catch(err => logger.error(`SLA monitor error: ${err.message}`));
}, 60_000);
slaMonitor.unref();

const criticalEscalationMonitor = setInterval(() => {
  runCriticalEscalations(io).catch(err => logger.error(`Critical escalation error: ${err.message}`));
}, 60_000);
criticalEscalationMonitor.unref();
runCriticalEscalations(io).catch(err => logger.error(`Initial critical escalation error: ${err.message}`));

const monthlyReportMonitor = setInterval(() => {
  runMonthlyReportScheduler().catch(err => logger.error(`Monthly report scheduler error: ${err.message}`));
}, 60 * 60_000);
monthlyReportMonitor.unref();
runMonthlyReportScheduler().catch(err => logger.error(`Initial monthly report scheduler error: ${err.message}`));

const cmdbInventoryMonitor=setInterval(()=>runCmdbInventoryScheduler().catch(err=>logger.error(`CMDB inventory scheduler error: ${err.message}`)),60_000);
cmdbInventoryMonitor.unref();
runCmdbInventoryScheduler().catch(err=>logger.error(`Initial CMDB inventory scheduler error: ${err.message}`));
const cmdbLifecycleMonitor=setInterval(()=>runCmdbLifecycleMonitor(io).catch(err=>logger.error(`CMDB lifecycle monitor error: ${err.message}`)),60*60_000);
cmdbLifecycleMonitor.unref();
runCmdbLifecycleMonitor(io).catch(err=>logger.error(`Initial CMDB lifecycle monitor error: ${err.message}`));
const commercialExpiryMonitor=setInterval(()=>runCommercialExpiryScheduler(io).catch(err=>logger.error(`Commercial expiry monitor error: ${err.message}`)),60*60_000);
commercialExpiryMonitor.unref();
runCommercialExpiryScheduler(io).catch(err=>logger.error(`Initial commercial expiry monitor error: ${err.message}`));

const statusPageMonitor=setInterval(()=>syncStatusServices().catch(err=>logger.error(`Status Page sync error: ${err.message}`)),60_000);
statusPageMonitor.unref();
syncStatusServices().catch(err=>logger.error(`Initial Status Page sync error: ${err.message}`));

const backupMonitor = setInterval(() => {
  runAutomaticBackup().catch(err => logger.error(`Automatic backup error: ${err.message}`));
}, 60_000);
backupMonitor.unref();

const deviceBackupMonitor = setInterval(() => {
  runDeviceBackupScheduler().catch(err => logger.error(`Device backup scheduler error: ${err.message}`));
}, 60_000);
deviceBackupMonitor.unref();
runDeviceBackupScheduler().catch(err => logger.error(`Initial device backup scheduler error: ${err.message}`));

const complianceMonitor = setInterval(() => {
  runComplianceScheduler().catch(err => logger.error(`Compliance scheduler error: ${err.message}`));
}, 60_000);
complianceMonitor.unref();
runComplianceScheduler().catch(err => logger.error(`Initial compliance scheduler error: ${err.message}`));

const complianceExceptionMonitor = setInterval(() => {
  runComplianceExceptionReminders(io).catch(err => logger.error(`Compliance exception reminder error: ${err.message}`));
}, 60 * 60_000);
complianceExceptionMonitor.unref();
runComplianceExceptionReminders(io).catch(err => logger.error(`Initial compliance exception reminder error: ${err.message}`));

const complianceEscalationMonitor = setInterval(() => {
  runComplianceEscalations(io).catch(err => logger.error(`Compliance escalation error: ${err.message}`));
}, 15 * 60_000);
complianceEscalationMonitor.unref();
runComplianceEscalations(io).catch(err => logger.error(`Initial compliance escalation error: ${err.message}`));

const capacityMonitor = setInterval(() => {
  runCapacityScheduler().catch(err => logger.error(`Capacity scheduler error: ${err.message}`));
}, 15 * 60_000);
capacityMonitor.unref();
runCapacityScheduler().catch(err => logger.error(`Initial capacity scheduler error: ${err.message}`));

const runbookScheduleMonitor = setInterval(runRunbookScheduleScheduler,60_000);
runbookScheduleMonitor.unref();
runRunbookScheduleScheduler();
const vulnerabilityMonitor=setInterval(()=>runVulnerabilityScheduler().catch(err=>logger.error(`Vulnerability scheduler error: ${err.message}`)),60_000);
vulnerabilityMonitor.unref();

// Graceful shutdown
process.on('SIGTERM', async () => {
  clearInterval(slaMonitor);
  clearInterval(criticalEscalationMonitor);
  clearInterval(statusPageMonitor);
  clearInterval(backupMonitor);
  clearInterval(deviceBackupMonitor);
  clearInterval(complianceMonitor);
  clearInterval(complianceExceptionMonitor);
  clearInterval(complianceEscalationMonitor);
  clearInterval(commercialExpiryMonitor);
  clearInterval(capacityMonitor);
  clearInterval(runbookScheduleMonitor);
  clearInterval(vulnerabilityMonitor);
  logger.info('SIGTERM received, shutting down...');
  await prisma.$disconnect();
  httpServer.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  clearInterval(slaMonitor);
  clearInterval(criticalEscalationMonitor);
  clearInterval(statusPageMonitor);
  clearInterval(backupMonitor);
  clearInterval(deviceBackupMonitor);
  clearInterval(complianceMonitor);
  clearInterval(complianceExceptionMonitor);
  clearInterval(complianceEscalationMonitor);
  clearInterval(capacityMonitor);
  clearInterval(runbookScheduleMonitor);
  clearInterval(vulnerabilityMonitor);
  logger.info('SIGINT received, shutting down...');
  await prisma.$disconnect();
  httpServer.close();
  process.exit(0);
});
