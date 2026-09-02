import net from 'node:net';
import prisma from '../database/client.js';
import { decrypt } from '../utils/crypto.js';
import logger from '../utils/logger.js';

const CACHE_KEY = 'flow_ip_reputation_cache', API_KEY = 'abuseipdb_api_key', DAILY_LIMIT_KEY = 'flow_reputation_daily_limit';
const DAY = 86400000, DEFAULT_LIMIT = 25, CACHE_TTL = DAY;
export const reputationEligibleIp = value => {
  if (net.isIP(value) !== 4) return false;
  const [a,b,c] = value.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0 && c === 113));
};
const readCache = async () => {
  const row = await prisma.settings.findUnique({ where: { key: CACHE_KEY } });
  try { const value = JSON.parse(row?.value || '{}'); return value && typeof value === 'object' ? value : {}; } catch { return {}; }
};
const saveCache = cache => prisma.settings.upsert({ where:{key:CACHE_KEY}, update:{value:JSON.stringify(cache),encrypted:false}, create:{key:CACHE_KEY,value:JSON.stringify(cache),encrypted:false} });
const safeResult = data => ({ provider:'abuseipdb', ipAddress:data.ipAddress, abuseConfidenceScore:Number(data.abuseConfidenceScore)||0, totalReports:Number(data.totalReports)||0, countryCode:data.countryCode||null, usageType:data.usageType||null, isp:data.isp||null, domain:data.domain||null, isWhitelisted:data.isWhitelisted===true, lastReportedAt:data.lastReportedAt||null, checkedAt:new Date().toISOString() });

export function reputationRiskPoints(reputation) {
  const score = Number(reputation?.abuseConfidenceScore) || 0;
  return score >= 90 ? 20 : score >= 70 ? 15 : score >= 40 ? 9 : score >= 10 ? 4 : 0;
}

export async function cachedIpReputations(addresses = []) {
  const cache = await readCache(), now = Date.now(), result = {};
  for (const ip of [...new Set(addresses.filter(Boolean))]) if (cache[ip]?.result && now - new Date(cache[ip].checkedAt).getTime() < CACHE_TTL) result[ip] = cache[ip].result;
  return result;
}

export async function getIpReputation(ip, { allowRemote = true } = {}) {
  ip = String(ip || '').trim();
  if (!reputationEligibleIp(ip)) throw Object.assign(new Error('A reputação aceita somente IPv4 público não reservado'), { statusCode:400 });
  const cache = await readCache(), now = Date.now();
  if (cache[ip]?.result && now - new Date(cache[ip].checkedAt).getTime() < CACHE_TTL) return { ...cache[ip].result, cached:true };
  if (!allowRemote) return null;
  const [keyRow, limitRow] = await Promise.all([prisma.settings.findUnique({where:{key:API_KEY}}),prisma.settings.findUnique({where:{key:DAILY_LIMIT_KEY}})]);
  if (!keyRow?.value) throw Object.assign(new Error('Configure a API Key do AbuseIPDB em Configurações'), { statusCode:409 });
  const day = new Date().toISOString().slice(0,10), used = Object.values(cache).filter(item => item.queryDay === day && item.remote === true).length, limit = Math.max(1,Math.min(500,Number(limitRow?.value)||DEFAULT_LIMIT));
  if (used >= limit) throw Object.assign(new Error(`Limite local diário de ${limit} consultas de reputação atingido`), { statusCode:429 });
  const apiKey = keyRow.encrypted ? decrypt(keyRow.value) : keyRow.value, controller = new AbortController(), timeout = setTimeout(()=>controller.abort(),6000);
  try {
    const url = new URL('https://api.abuseipdb.com/api/v2/check'); url.searchParams.set('ipAddress',ip); url.searchParams.set('maxAgeInDays','90');
    const response = await fetch(url,{headers:{Accept:'application/json',Key:apiKey},signal:controller.signal}), body = await response.json().catch(()=>({}));
    if (!response.ok) { const detail=body?.errors?.[0]?.detail || `HTTP ${response.status}`; throw Object.assign(new Error(`AbuseIPDB: ${detail}`),{statusCode:response.status===429?429:502}); }
    const result=safeResult(body.data||{}); cache[ip]={result,checkedAt:result.checkedAt,queryDay:day,remote:true};
    for(const [address,item] of Object.entries(cache)) if(now-new Date(item.checkedAt||0).getTime()>30*DAY) delete cache[address];
    await saveCache(cache); return {...result,cached:false};
  } catch(error) { if(error.name==='AbortError') throw Object.assign(new Error('AbuseIPDB não respondeu dentro de 6 segundos'),{statusCode:504}); throw error; }
  finally { clearTimeout(timeout); }
}

export async function enrichConfirmedAnomalyReputation(anomaly) {
  if (!anomaly?.sourceAddress) return null;
  try { return await getIpReputation(anomaly.sourceAddress); }
  catch(error) { logger.warn(`Reputação ${anomaly.sourceAddress}: ${error.message}`); return null; }
}
