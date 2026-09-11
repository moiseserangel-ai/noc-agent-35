import logger from '../utils/logger.js';

export function parseZabbixAlert(body) {
  try {
    const clean = value => {
      if (value === undefined || value === null) return null;
      const text = String(value).trim();
      return !text || /^\{[^}]+\}$/.test(text) ? null : text;
    };
    const timestamp = value => {
      const parsed = Number(clean(value));
      return Number.isFinite(parsed) && parsed > 0 ? new Date(parsed * 1000) : null;
    };
    const {
      host,
      hostname,
      hostId,
      trigger,
      severity,
      status,
      message,
      eventId,
      itemName,
      itemValue,
      eventValue,
      eventTimestamp,
      recoveryEventId,
      recoveryTimestamp,
    } = body;

    const severityMap = {
      '0': 'not_classified',
      '1': 'information',
      '2': 'warning',
      '3': 'average',
      '4': 'high',
      '5': 'disaster',
    };

    const priorityMap = {
      'not_classified': 'low',
      'information': 'low',
      'warning': 'medium',
      'average': 'medium',
      'high': 'high',
      'disaster': 'critical',
    };

    const cleanSeverity = clean(severity);
    const sev = severityMap[cleanSeverity] || cleanSeverity?.toLowerCase() || 'average';
    const cleanStatus = clean(status);
    const cleanEventValue = clean(eventValue);
    const cleanRecoveryId = clean(recoveryEventId);
    const isRecovery = cleanEventValue === '0' || /resolved|recovery|ok/i.test(cleanStatus || '') || Boolean(cleanRecoveryId);
    const cleanHost = clean(host) || clean(hostname) || 'Unknown';
    const cleanHostId = clean(hostId);
    const cleanTrigger = clean(trigger) || clean(message) || 'Unknown trigger';

    return {
      host: cleanHost,
      hostId: cleanHostId,
      trigger: cleanTrigger,
      severity: sev,
      priority: priorityMap[sev] || 'medium',
      status: cleanStatus || (isRecovery ? 'RESOLVED' : 'PROBLEM'),
      state: isRecovery ? 'resolved' : 'problem',
      eventId: clean(eventId),
      recoveryEventId: cleanRecoveryId,
      eventAt: timestamp(eventTimestamp),
      recoveryAt: timestamp(recoveryTimestamp),
      itemName: clean(itemName),
      itemValue: clean(itemValue),
      incidentKey: `${cleanHostId || cleanHost}::${cleanTrigger}`.toLowerCase(),
      raw: body,
    };
  } catch (err) {
    logger.error(`Error parsing Zabbix alert: ${err.message}`);
    return null;
  }
}

export function formatAlertMessage(alert) {
  const emoji = {
    low: 'ℹ️',
    medium: '⚠️',
    high: '🔴',
    critical: '🚨',
  };

  return [
    `${emoji[alert.priority] || '⚠️'} **ALERTA ZABBIX**`,
    `📍 Host: ${alert.host}`,
    `🔔 Trigger: ${alert.trigger}`,
    `📊 Severidade: ${alert.severity}`,
    alert.itemName ? `📈 Item: ${alert.itemName} = ${alert.itemValue}` : '',
    `⏰ Status: ${alert.status}`,
    alert.eventId ? `🔗 Evento: ${alert.eventId}` : '',
  ].filter(Boolean).join('\n');
}
