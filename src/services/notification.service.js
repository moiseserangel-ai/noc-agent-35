import prisma from '../database/client.js';
import logger from '../utils/logger.js';
import { decrypt } from '../utils/crypto.js';
import { sendToAdmin } from './evolution.service.js';
import { logAudit } from './audit.service.js';
import { resolveNotificationRules } from './notification-rule.service.js';

const split = value => String(value || '').split(',').map(x => x.trim()).filter(Boolean);

export async function getNotificationConfig() {
  const keys = ['notifications_enabled', 'telegram_bot_token', 'telegram_chat_ids', 'notification_base_url', 'notify_high_channels', 'notify_critical_channels', 'notify_sla_channels', 'notify_resolved'];
  const rows = await prisma.settings.findMany({ where: { key: { in: keys } } });
  const data = Object.fromEntries(rows.map(row => [row.key, row.encrypted ? decrypt(row.value) : row.value]));
  return {
    enabled: data.notifications_enabled === 'true',
    telegramToken: data.telegram_bot_token || '',
    telegramChats: split(data.telegram_chat_ids),
    baseUrl: String(data.notification_base_url || '').replace(/\/$/, ''),
    highChannels: split(data.notify_high_channels || 'telegram'),
    criticalChannels: split(data.notify_critical_channels || 'telegram,whatsapp'),
    slaChannels: split(data.notify_sla_channels || 'telegram,whatsapp'),
    notifyResolved: data.notify_resolved !== 'false',
  };
}

export async function sendTelegramMessage(chatId, text, tokenOverride) {
  const cfg = await getNotificationConfig();
  const token = tokenOverride || cfg.telegramToken;
  if (!token || !chatId) throw new Error('Token do Telegram ou Chat ID não configurado');
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }) });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.description || `Telegram HTTP ${response.status}`);
  return data;
}

const channelsFor = (task, event, cfg) => {
  if (event.startsWith('sla_')) return cfg.slaChannels;
  if (task.priority === 'critical') return cfg.criticalChannels;
  if (task.priority === 'high') return cfg.highChannels;
  return [];
};

const format = (task, event, message, baseUrl) => {
  const labels = { opened: 'Novo incidente', reopened: 'Incidente reaberto', acknowledged: 'Incidente reconhecido', resolved: 'Incidente resolvido', validated: 'Resolução validada', closed: 'Incidente encerrado', sla_warning: 'SLA próximo do vencimento', sla_ack_breached: 'SLA de reconhecimento violado', sla_resolution_breached: 'SLA de resolução violado' };
  const label = event.startsWith('critical_reminder_') ? 'Lembrete de incidente crítico sem reconhecimento' : labels[event] || event;
  return [`${event.startsWith('sla_') ? '🚨' : task.priority === 'critical' ? '🚨' : task.priority === 'high' ? '🔴' : 'ℹ️'} ${label}`, `Task: #${task.taskNumber}`, `Prioridade: ${task.priority}`, task.device?.name ? `Equipamento: ${task.device.name}` : '', message || task.originalMessage, baseUrl ? `Abrir: ${baseUrl}/tasks` : ''].filter(Boolean).join('\n');
};

async function record(task, event, channel, recipient, status, error = null, meta = {}) {
  const dedupKey = `${task.id}:${task.occurrenceCount || 1}:${event}:${channel}:${recipient || 'default'}`;
  try { await prisma.notificationLog.create({ data: { taskId: task.id, taskNumber: task.taskNumber, event, channel, recipient: recipient || null, status, error: error?.slice(0, 1000) || null, dedupKey,title:meta.title||null,message:meta.message||null,priority:task.priority||null,resourceType:'task',resourceId:task.id } }); return true; }
  catch (err) { if (err.code === 'P2002') return false; throw err; }
}

async function recordStandalone(resourceId, event, channel, recipient, status, error = null, meta = {}) {
  const dedupKey = `${resourceId}:${event}:${channel}:${recipient || 'default'}`;
  try { await prisma.notificationLog.create({ data:{event,channel,recipient:recipient||null,status,error:error?.slice(0,1000)||null,dedupKey,title:meta.title||null,message:meta.message||null,priority:meta.priority||null,resourceType:meta.resourceType||null,resourceId:meta.resourceId||resourceId} }); return true; }
  catch(error){if(error.code==='P2002')return false;throw error;}
}

export async function notifyTask(task, event, { message = '', io = null } = {}) {
  const cfg = await getNotificationConfig();
  const text = format(task, event, message, cfg.baseUrl);
  const title=text.split('\n')[0];
  const results = [];
  const panelRecorded = await record(task, event, 'panel', null, 'sent',null,{title,message:text});
  if (panelRecorded) { io?.emit('task:notification', { taskId: task.id, taskNumber: task.taskNumber, event, message: text }); results.push({ channel: 'panel', status: 'sent' }); }
  if (!cfg.enabled || (event === 'resolved' && !cfg.notifyResolved)) return results;
  const routing=await resolveNotificationRules(task,event);
  const channels=routing?.channels?.filter(channel=>channel!=='panel')||channelsFor(task,event,cfg);
  for (const channel of [...new Set(channels)]) {
    const recipients = channel === 'telegram' ? (routing?.recipients?.length?routing.recipients:cfg.telegramChats) : [null];
    for (const recipient of recipients) {
      const keyExists = await prisma.notificationLog.findUnique({ where: { dedupKey: `${task.id}:${task.occurrenceCount || 1}:${event}:${channel}:${recipient || 'default'}` } });
      if (keyExists) continue;
      try {
        if (channel === 'telegram') await sendTelegramMessage(recipient, text, cfg.telegramToken);
        else if (channel === 'whatsapp') { const sent = await sendToAdmin(text); if (!sent) throw new Error('WhatsApp Admin não configurado'); }
        else continue;
        await record(task, event, channel, recipient, 'sent',null,{title,message:text}); results.push({ channel, recipient, status: 'sent' });
      } catch (error) {
        await record(task, event, channel, recipient, 'failed', error.message,{title,message:text}); results.push({ channel, recipient, status: 'failed', error: error.message });
        logger.warn(`Notification ${channel} failed for Task #${task.taskNumber}: ${error.message}`);
      }
    }
  }
  await logAudit({ username: 'system', displayName: 'Sistema de notificações', role: 'system', action: 'notify', resource: 'task', resourceId: task.id, status: results.some(x => x.status === 'failed') ? 'failure' : 'success', details: { taskNumber: task.taskNumber, event, channels: results.map(x => ({ channel: x.channel, status: x.status })) } });
  return results;
}

export async function runCriticalReminders(io = null) {
  const cfg = await getNotificationConfig();
  if (!cfg.enabled) return [];
  const row = await prisma.settings.findUnique({ where: { key: 'critical_reminder_minutes' } });
  const minutes = Math.max(Number(row?.value) || 30, 5);
  const cutoff = new Date(Date.now() - minutes * 60_000);
  const tasks = await prisma.task.findMany({ where: { priority: 'critical', acknowledgedAt: null, status: { notIn: ['resolved', 'completed', 'validated', 'closed', 'cancelled'] }, OR: [{ incidentOpenedAt: { lte: cutoff } }, { incidentOpenedAt: null, createdAt: { lte: cutoff } }] }, include: { device: true } });
  const bucket = Math.floor(Date.now() / (minutes * 60_000));
  const results = [];
  for (const task of tasks) results.push(...await notifyTask(task, `critical_reminder_${bucket}`, { message: `Incidente crítico permanece sem reconhecimento há mais de ${minutes} minutos.`, io }));
  return results;
}

export async function notifyComplianceException(exception, thresholdDays, io = null) {
  const cfg=await getNotificationConfig();
  if(!cfg.enabled)return [];
  const event=`compliance_exception_expiry_${thresholdDays}d`;
  const text=[
    thresholdDays<=1?'🚨 Exceção de compliance vence em até 1 dia':'⚠️ Exceção de compliance próxima do vencimento',
    `Equipamento: ${exception.device.name}`,
    `Controle: ${exception.ruleKey}`,
    `Vencimento: ${exception.expiresAt.toLocaleString('pt-BR',{timeZone:'America/Porto_Velho'})}`,
    `Responsável: ${exception.approvedBy}`,
    `Justificativa: ${exception.reason}`,
    cfg.baseUrl?`Revisar: ${cfg.baseUrl}/compliance`:'',
  ].filter(Boolean).join('\n');
  const results=[];
  const meta={title:text.split('\n')[0],message:text,priority:thresholdDays<=1?'critical':'high',resourceType:'compliance_exception',resourceId:exception.id};
  if(await recordStandalone(`compliance-exception:${exception.id}`,event,'panel',null,'sent',null,meta)){
    io?.emit('compliance:notification',{exceptionId:exception.id,event,message:text});
    results.push({channel:'panel',status:'sent'});
  }
  const channels=thresholdDays<=1?cfg.criticalChannels:cfg.highChannels;
  for(const channel of [...new Set(channels)]){
    const recipients=channel==='telegram'?cfg.telegramChats:[null];
    for(const recipient of recipients){
      const dedupKey=`compliance-exception:${exception.id}:${event}:${channel}:${recipient||'default'}`;
      if(await prisma.notificationLog.findUnique({where:{dedupKey}}))continue;
      try{
        if(channel==='telegram')await sendTelegramMessage(recipient,text,cfg.telegramToken);
        else if(channel==='whatsapp'){const sent=await sendToAdmin(text);if(!sent)throw new Error('WhatsApp Admin não configurado');}
        else continue;
        await recordStandalone(`compliance-exception:${exception.id}`,event,channel,recipient,'sent',null,meta);
        results.push({channel,recipient,status:'sent'});
      }catch(error){
        await recordStandalone(`compliance-exception:${exception.id}`,event,channel,recipient,'failed',error.message,meta);
        results.push({channel,recipient,status:'failed',error:error.message});
        logger.warn(`Compliance exception notification ${channel} failed: ${error.message}`);
      }
    }
  }
  await logAudit({username:'system',displayName:'Sistema de notificações',role:'system',action:'expiry_notice',resource:'compliance_exception',resourceId:exception.id,status:results.some(item=>item.status==='failed')?'failure':'success',details:{thresholdDays,channels:results.map(item=>({channel:item.channel,status:item.status}))}});
  return results;
}

export async function notifyRunbookEvent({resourceId,event,title,message,critical=false}){
  const cfg=await getNotificationConfig();
  const text=[critical?'🚨 Automação de Runbook':'⚙️ Automação de Runbook',title,message,cfg.baseUrl?`Abrir: ${cfg.baseUrl}/runbooks`:null].filter(Boolean).join('\n');
  const results=[];
  const meta={title:title||'Automação de Runbook',message:text,priority:critical?'critical':'medium',resourceType:'runbook',resourceId};
  if(await recordStandalone(`runbook:${resourceId}`,event,'panel',null,'sent',null,meta))results.push({channel:'panel',status:'sent'});
  if(!cfg.enabled)return results;
  const channels=critical?cfg.criticalChannels:cfg.highChannels;
  for(const channel of [...new Set(channels)]){
    const recipients=channel==='telegram'?cfg.telegramChats:[null];
    for(const recipient of recipients){
      const key=`runbook:${resourceId}:${event}:${channel}:${recipient||'default'}`;
      if(await prisma.notificationLog.findUnique({where:{dedupKey:key}}))continue;
      try{
        if(channel==='telegram')await sendTelegramMessage(recipient,text,cfg.telegramToken);
        else if(channel==='whatsapp'){const sent=await sendToAdmin(text);if(!sent)throw new Error('WhatsApp Admin não configurado');}
        else continue;
        await recordStandalone(`runbook:${resourceId}`,event,channel,recipient,'sent',null,meta);results.push({channel,status:'sent'});
      }catch(error){await recordStandalone(`runbook:${resourceId}`,event,channel,recipient,'failed',error.message,meta);results.push({channel,status:'failed'});}
    }
  }
  return results;
}
