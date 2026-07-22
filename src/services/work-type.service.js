export function inferWorkType(message, source = '', suggested = '') {
  if (String(source).startsWith('zabbix')) return 'incident';
  if (['incident', 'consultation', 'configuration'].includes(suggested)) return suggested;
  const text = String(message || '').toLowerCase();
  if (/\b(configur|alter|cri(e|ar)|adicion|remov|exclu|desativ|ativ|bloque|liber|aplic|reinici|instal|atualiz|migr)/i.test(text)) return 'configuration';
  if (/\b(caiu|falha|erro|indispon|offline|down|lento|perda|alerta|incidente|problema|sem acesso|não responde|nao responde)/i.test(text)) return 'incident';
  return 'consultation';
}
