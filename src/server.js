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
import { authMiddleware, verifyToken } from './middleware/auth.middleware.js';

import authRoutes from './routes/auth.routes.js';
import deviceRoutes from './routes/device.routes.js';
import settingsRoutes from './routes/settings.routes.js';
import taskRoutes from './routes/task.routes.js';
import chatRoutes from './routes/chat.routes.js';
import webhookRoutes from './routes/webhook.routes.js';
import vpnRoutes from './routes/vpn.routes.js';

import prisma from './database/client.js';
import SupportAgent from './agents/support-agent.js';
import MikrotikAgent from './agents/mikrotik-agent.js';
import LinuxAgent from './agents/linux-agent.js';
import * as taskService from './services/task.service.js';
import { runSlaMonitor } from './services/sla.service.js';
import * as evolutionService from './services/evolution.service.js';

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

// Protected routes
app.use('/api/devices', authMiddleware, deviceRoutes);
app.use('/api/settings', authMiddleware, settingsRoutes);
app.use('/api/tasks', authMiddleware, taskRoutes);
app.use('/api/chat', authMiddleware, chatRoutes);
app.use('/api/vpn', authMiddleware, vpnRoutes);

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
  mikrotik: new MikrotikAgent(),
  linux: new LinuxAgent(),
};

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) throw new Error('Token ausente');
    socket.user = verifyToken(token);
    next();
  } catch {
    next(new Error('Não autorizado'));
  }
});

io.on('connection', (socket) => {
  logger.info(`Dashboard client connected: ${socket.id}`);

  socket.on('chat:message', async ({ sessionId, message, agentType = 'support' }) => {
    try {
      if (typeof sessionId !== 'string' || typeof message !== 'string' || message.length > 4000) throw new Error('Mensagem inválida');
      const ownedSession = await prisma.chatSession.findUnique({ where: { id: sessionId } });
      if (!ownedSession) throw new Error('Sessão inválida');
      const agent = agents[agentType];
      if (!agent) {
        socket.emit('chat:error', { error: `Agent "${agentType}" not found` });
        return;
      }

      // Save user message
      await prisma.chatMessage.create({
        data: { sessionId, role: 'user', content: message },
      });

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
        await taskService.updateTask(task.id, { status: 'resolved', executionResult: execution.text, resolutionSummary: execution.text, resolutionType: 'agent', resolvedAt: new Date() });
        await taskService.addTaskMessage(task.id, 'agent', execution.text, task.agentUsed);
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
      socket.emit('chat:typing', { agentType });
      
      const result = await agent.runStreaming(message, (chunk) => {
        // If it's SupportAgent, we hide the text stream to prevent raw JSON from showing up,
        // but we still emit tool events.
        if (agentType !== 'support' && chunk.type === 'text') {
          socket.emit('chat:chunk', { text: chunk.text });
        } else if (chunk.type === 'tool_start') {
          socket.emit('chat:tool', { status: 'start', tool: chunk.tool, input: chunk.input });
        } else if (chunk.type === 'tool_result') {
          socket.emit('chat:tool', { status: 'result', tool: chunk.tool, output: chunk.output });
        }
      });

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
                });
                const taskNum = dashboardTask.taskNumber;
                await taskService.updateTask(dashboardTask.id, { status: 'diagnosing', agentUsed: deviceType });
                const prompt = `Você recebeu uma solicitação do NOC.

**Dispositivo:** ${deviceName} (ID: ${deviceId})
**Tipo:** ${deviceType === 'mikrotik' ? 'MikroTik RouterOS' : 'Linux'}
**Task:** #TASK-${taskNum}
**Solicitação:** ${originalRequest}

Acesse o equipamento, analise e atenda à solicitação da forma mais autônoma possível. Use o deviceId "${deviceId}" em todas as chamadas de tools.`;

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
                });

                result.text += `\n\n🔄 **Encaminhando para especialista em ${deviceType}...**\n\n${specialistResult.text}`;
                result.toolsUsed.push(...specialistResult.toolsUsed);
                const needsApproval = /responda\s+com\s+sim|aguardando\s+aprova[cç][aã]o/i.test(specialistResult.text);
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
            } else if (classification.action === 'unknown') {
              socket.emit('chat:chunk', { text: classification.message || '\n\nNão consegui identificar o equipamento ou a ação desejada.' });
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
      await prisma.chatMessage.create({
        data: {
          sessionId,
          role: 'assistant',
          content: result.text,
          agentUsed: agentType,
          toolCalls: result.toolsUsed.length > 0 ? JSON.stringify(result.toolsUsed) : null,
        },
      });

      socket.emit('chat:complete', {
        text: result.text,
        agentUsed: agentType,
        toolsUsed: result.toolsUsed,
      });
    } catch (err) {
      logger.error(`Chat error: ${err.message}`);
      socket.emit('chat:error', { error: err.message });
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

const slaMonitor = setInterval(() => {
  runSlaMonitor(async (task, message) => {
    io.emit('task:sla', { taskId: task.id, taskNumber: task.taskNumber, message });
    await evolutionService.sendToAdmin(message);
  }).catch(err => logger.error(`SLA monitor error: ${err.message}`));
}, 60_000);
slaMonitor.unref();

// Graceful shutdown
process.on('SIGTERM', async () => {
  clearInterval(slaMonitor);
  logger.info('SIGTERM received, shutting down...');
  await prisma.$disconnect();
  httpServer.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  clearInterval(slaMonitor);
  logger.info('SIGINT received, shutting down...');
  await prisma.$disconnect();
  httpServer.close();
  process.exit(0);
});
