import prisma from '../database/client.js';

const split=value=>String(value||'').split(',').map(item=>item.trim()).filter(Boolean);
const matches=(configured,value)=>!configured.length||configured.includes(String(value||''));
const timeParts=(date,timeZone)=>{
  const values=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).filter(item=>item.type!=='literal').map(item=>[item.type,item.value]));
  const days={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};
  return{day:days[values.weekday],time:`${values.hour}:${values.minute}`};
};
export function ruleMatches(rule,{task,event,now=new Date()}){
  const source=String(task.source||'').startsWith('dashboard:')?'dashboard':task.source;
  if(!rule.enabled||!matches(split(rule.priorities),task.priority)||!matches(split(rule.events),event)||!matches(split(rule.sources),source)||!matches(split(rule.deviceGroups),task.device?.group))return false;
  try{
    const local=timeParts(now,rule.timezone);if(!split(rule.activeDays).map(Number).includes(local.day))return false;
    return rule.startTime<=rule.endTime?local.time>=rule.startTime&&local.time<=rule.endTime:local.time>=rule.startTime||local.time<=rule.endTime;
  }catch{return false;}
}
export async function resolveNotificationRules(task,event){
  const rules=await prisma.notificationRule.findMany({where:{enabled:true},orderBy:{sortOrder:'asc'}});
  const matched=rules.filter(rule=>ruleMatches(rule,{task,event}));
  if(!matched.length)return null;
  return{ruleIds:matched.map(rule=>rule.id),channels:[...new Set(matched.flatMap(rule=>split(rule.channels)))],recipients:[...new Set(matched.flatMap(rule=>split(rule.recipients)))]};
}
export const publicRule=rule=>({...rule,priorities:split(rule.priorities),events:split(rule.events),sources:split(rule.sources),deviceGroups:split(rule.deviceGroups),channels:split(rule.channels),recipients:split(rule.recipients),activeDays:split(rule.activeDays).map(Number)});
export function validateNotificationRule(input,actor){
  const timezone=String(input.timezone||'America/Porto_Velho');try{new Intl.DateTimeFormat('pt-BR',{timeZone:timezone}).format();}catch{throw Object.assign(new Error('Fuso horário inválido'),{statusCode:400});}
  const time=value=>/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value))?String(value):null;
  const startTime=time(input.startTime),endTime=time(input.endTime);if(!startTime||!endTime)throw Object.assign(new Error('Horário da regra inválido'),{statusCode:400});
  const array=value=>Array.isArray(value)?value.map(String).filter(Boolean):split(value);
  const channels=array(input.channels).filter(item=>['panel','telegram','whatsapp'].includes(item));if(!channels.length)throw Object.assign(new Error('Selecione ao menos um canal'),{statusCode:400});
  return{name:String(input.name||'').trim().slice(0,120),enabled:input.enabled!==false,sortOrder:Math.max(1,Math.min(Number(input.sortOrder)||100,999)),priorities:array(input.priorities).join(','),events:array(input.events).join(','),sources:array(input.sources).join(','),deviceGroups:array(input.deviceGroups).join(','),channels:channels.join(','),recipients:array(input.recipients).join(','),activeDays:array(input.activeDays).map(Number).filter(day=>day>=0&&day<=6).join(',')||'0,1,2,3,4,5,6',startTime,endTime,timezone,createdBy:actor};
}
