import prisma from '../database/client.js';
import https from 'node:https';
import logger from '../utils/logger.js';
import { decrypt } from '../utils/crypto.js';
import { sendToAdmin, sendWhatsAppMessage } from './evolution.service.js';
import { logAudit } from './audit.service.js';
import { resolveNotificationRules } from './notification-rule.service.js';
import { resolveOnCallContacts } from './on-call.service.js';
import { cmdbOperationalContext, formatBusinessImpact } from './cmdb-operational-context.service.js';

const split = value => String(value || '').split(',').map(x => x.trim()).filter(Boolean);
const number = (value, fallback) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;

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
  const body=JSON.stringify({chat_id:chatId,text,disable_web_page_preview:true});
  const {status,data}=await new Promise((resolve,reject)=>{const request=https.request({hostname:'api.telegram.org',path:`/bot${token}/sendMessage`,method:'POST',family:4,timeout:15000,headers:{'content-type':'application/json','content-length':Buffer.byteLength(body)}},response=>{const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>{try{resolve({status:response.statusCode,data:JSON.parse(Buffer.concat(chunks).toString('utf8'))});}catch{reject(new Error(`Telegram retornou resposta inválida (HTTP ${response.statusCode})`));}});});request.on('timeout',()=>request.destroy(new Error('Tempo esgotado ao conectar com o Telegram')));request.on('error',reject);request.end(body);});
  if (status < 200 || status >= 300 || !data.ok) throw new Error(data.description || `Telegram HTTP ${status}`);
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
  const label = event.startsWith('critical_escalation_level_') ? `Escalonamento crítico — nível ${event.split('_').at(-1)}` : event.startsWith('critical_reminder_') ? 'Lembrete de incidente crítico sem reconhecimento' : labels[event] || event;
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

export async function notifyCmdbLifecycleAlert(alert,io=null){
  const cfg=await getNotificationConfig(),event=`cmdb_${alert.type}_${alert.stage}`,text=[alert.severity==='critical'?'🚨 CMDB — ciclo de vida':'⚠️ CMDB — ciclo de vida',alert.title,alert.message,cfg.baseUrl?`Revisar: ${cfg.baseUrl}/cmdb`:null].filter(Boolean).join('\n'),meta={title:alert.title,message:text,priority:alert.severity,resourceType:'cmdb_lifecycle_alert',resourceId:alert.id},results=[];
  if(await recordStandalone(`cmdb-alert:${alert.id}`,event,'panel',null,'sent',null,meta)){io?.emit('cmdb:notification',{alertId:alert.id,event,message:text});results.push({channel:'panel',status:'sent'});}
  if(!cfg.enabled||!['high','critical'].includes(alert.severity))return results;
  const channels=alert.severity==='critical'?cfg.criticalChannels:cfg.highChannels;
  for(const channel of [...new Set(channels)])for(const recipient of channel==='telegram'?cfg.telegramChats:[null]){const key=`cmdb-alert:${alert.id}:${event}:${channel}:${recipient||'default'}`;if(await prisma.notificationLog.findUnique({where:{dedupKey:key}}))continue;try{if(channel==='telegram')await sendTelegramMessage(recipient,text,cfg.telegramToken);else if(channel==='whatsapp'){const sent=await sendToAdmin(text);if(!sent)throw new Error('WhatsApp Admin não configurado');}else continue;await recordStandalone(`cmdb-alert:${alert.id}`,event,channel,recipient,'sent',null,meta);results.push({channel,status:'sent'});}catch(error){await recordStandalone(`cmdb-alert:${alert.id}`,event,channel,recipient,'failed',error.message,meta);results.push({channel,status:'failed'});}}
  return results;
}

export async function notifyTask(task, event, { message = '', io = null, channelsOverride = null, recipientsOverride = null, whatsappRecipientsOverride = null } = {}) {
  const cfg = await getNotificationConfig();
  const businessImpact=task.deviceId?formatBusinessImpact(await cmdbOperationalContext([task.deviceId])):'';
  const text = format(task, event, [message,businessImpact].filter(Boolean).join('\n\n'), cfg.baseUrl);
  const title=text.split('\n')[0];
  const results = [];
  const panelRecorded = await record(task, event, 'panel', null, 'sent',null,{title,message:text});
  if (panelRecorded) { io?.emit('task:notification', { taskId: task.id, taskNumber: task.taskNumber, event, message: text }); results.push({ channel: 'panel', status: 'sent' }); }
  if (!cfg.enabled || (event === 'resolved' && !cfg.notifyResolved)) return results;
  const routing=await resolveNotificationRules(task,event);
  const channels=routing?.channels?.filter(channel=>channel!=='panel')||(channelsOverride||channelsFor(task,event,cfg));
  for (const channel of [...new Set(channels)]) {
    const recipients = channel === 'telegram'
      ? (routing?.recipients?.length?routing.recipients:recipientsOverride?.length?recipientsOverride:cfg.telegramChats)
      : channel === 'whatsapp'&&whatsappRecipientsOverride?.length ? whatsappRecipientsOverride : [null];
    for (const recipient of recipients) {
      const keyExists = await prisma.notificationLog.findUnique({ where: { dedupKey: `${task.id}:${task.occurrenceCount || 1}:${event}:${channel}:${recipient || 'default'}` } });
      if (keyExists) continue;
      try {
        if (channel === 'telegram') await sendTelegramMessage(recipient, text, cfg.telegramToken);
        else if (channel === 'whatsapp') { const sent = recipient?await sendWhatsAppMessage(recipient,text):await sendToAdmin(text); if (!sent) throw new Error('WhatsApp Admin não configurado'); }
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

export function evaluateCriticalEscalation(openedAt, currentLevel, thresholds, now = new Date()) {
  const elapsedMinutes = Math.max(0, (now.getTime() - new Date(openedAt).getTime()) / 60_000);
  let level = 0;
  thresholds.forEach((minutes, index) => { if (elapsedMinutes >= minutes) level = index + 1; });
  return level > Number(currentLevel || 0) ? level : 0;
}

export async function runCriticalEscalations(io = null) {
  const keys = [
    'critical_escalation_enabled',
    'critical_escalation_level1_minutes','critical_escalation_level2_minutes','critical_escalation_level3_minutes',
    'critical_escalation_level1_channels','critical_escalation_level2_channels','critical_escalation_level3_channels',
    'critical_escalation_level1_recipients','critical_escalation_level2_recipients','critical_escalation_level3_recipients',
  ];
  const rows = await prisma.settings.findMany({ where: { key: { in: keys } } });
  const settings = Object.fromEntries(rows.map(row => [row.key, row.encrypted ? decrypt(row.value) : row.value]));
  if (settings.critical_escalation_enabled !== 'true') return [];
  const thresholds = [
    number(settings.critical_escalation_level1_minutes, 5),
    number(settings.critical_escalation_level2_minutes, 15),
    number(settings.critical_escalation_level3_minutes, 30),
  ];
  if (!(thresholds[0] < thresholds[1] && thresholds[1] < thresholds[2])) {
    logger.warn('Critical escalation ignored: level times must be progressively increasing');
    return [];
  }
  const tasks = await prisma.task.findMany({
    where: { priority: 'critical', acknowledgedAt: null, status: { notIn: ['resolved','completed','validated','closed','cancelled'] } },
    include: { device: true },
  });
  const results = [];
  for (const task of tasks) {
    const onCall=await resolveOnCallContacts(new Date(),task.tenantId||null);
    const openedAt = task.incidentOpenedAt || task.createdAt;
    const targetLevel = evaluateCriticalEscalation(openedAt, task.criticalEscalationLevel, thresholds);
    if (!targetLevel) continue;
    const minutes = thresholds[targetLevel - 1];
    const onCallNames=onCall.members.map(member=>`${member.name} — ${member.teamName}`);
    const message = `Incidente crítico sem reconhecimento há ${Math.floor((Date.now() - new Date(openedAt).getTime()) / 60_000)} minutos. Escalonamento automático nível ${targetLevel} (limite: ${minutes} min).${onCallNames.length?`\nPlantão acionado: ${onCallNames.join(', ')}`:''}`;
    await prisma.$transaction([
      prisma.task.update({ where: { id: task.id }, data: { criticalEscalationLevel: targetLevel } }),
      prisma.taskMessage.create({ data: { taskId: task.id, role: 'system', content: `🚨 ${message}` } }),
    ]);
    const channels = split(settings[`critical_escalation_level${targetLevel}_channels`] || (targetLevel === 1 ? 'telegram' : 'telegram,whatsapp'));
    const recipients = [...new Set([...split(settings[`critical_escalation_level${targetLevel}_recipients`]),...onCall.telegram])];
    const delivery = await notifyTask({ ...task, criticalEscalationLevel: targetLevel }, `critical_escalation_level_${targetLevel}`, { message, io, channelsOverride: channels, recipientsOverride: recipients, whatsappRecipientsOverride:onCall.whatsapp });
    io?.emit('task:escalation', { taskId: task.id, taskNumber: task.taskNumber, level: targetLevel, message });
    results.push({ taskId: task.id, taskNumber: task.taskNumber, level: targetLevel, delivery });
  }
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

export async function notifyStatusPageEvent({resourceId,event,title,message,critical=false}){
  const cfg=await getNotificationConfig(),text=[critical?'🚨 Status Page':'📡 Status Page',title,message,cfg.baseUrl?`Acompanhar: ${cfg.baseUrl}/status`:null].filter(Boolean).join('\n');
  const meta={title:title||'Atualização da Status Page',message:text,priority:critical?'critical':'medium',resourceType:'status_incident',resourceId};
  const results=[];
  if(await recordStandalone(`status:${resourceId}`,event,'panel',null,'sent',null,meta))results.push({channel:'panel',status:'sent'});
  if(!cfg.enabled)return results;
  const channels=critical?cfg.criticalChannels:cfg.highChannels;
  for(const channel of [...new Set(channels)])for(const recipient of channel==='telegram'?cfg.telegramChats:[null]){
    const key=`status:${resourceId}:${event}:${channel}:${recipient||'default'}`;if(await prisma.notificationLog.findUnique({where:{dedupKey:key}}))continue;
    try{if(channel==='telegram')await sendTelegramMessage(recipient,text,cfg.telegramToken);else if(channel==='whatsapp'){const sent=await sendToAdmin(text);if(!sent)throw new Error('WhatsApp Admin não configurado');}else continue;await recordStandalone(`status:${resourceId}`,event,channel,recipient,'sent',null,meta);results.push({channel,status:'sent'});}
    catch(error){await recordStandalone(`status:${resourceId}`,event,channel,recipient,'failed',error.message,meta);results.push({channel,status:'failed'});}
  }
  return results;
}
