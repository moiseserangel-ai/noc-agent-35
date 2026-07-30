import prisma from '../database/client.js';
import logger from '../utils/logger.js';
import { decrypt, encrypt } from '../utils/crypto.js';
import { createSimulation, executeRunbook, renderRunbook } from './runbook.service.js';
import { logAudit } from './audit.service.js';
import { notifyRunbookEvent } from './notification.service.js';

const json=value=>{try{return JSON.parse(value);}catch{return{};}};
const definition=row=>({...row,variables:JSON.parse(row.variables||'[]'),steps:JSON.parse(row.steps||'[]')});

function zonedParts(date,timeZone){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date);
  return Object.fromEntries(parts.filter(part=>part.type!=='literal').map(part=>[part.type,Number(part.value)]));
}
function zonedDate(year,month,day,hour,minute,timeZone){
  let guess=Date.UTC(year,month-1,day,hour,minute);
  for(let index=0;index<2;index++){const p=zonedParts(new Date(guess),timeZone);const represented=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute);guess-=represented-Date.UTC(year,month-1,day,hour,minute);}
  return new Date(guess);
}
export function validateTimezone(value){
  const timezone=String(value||'America/Porto_Velho');
  try{new Intl.DateTimeFormat('pt-BR',{timeZone:timezone}).format();return timezone;}catch{throw Object.assign(new Error('Fuso horário inválido'),{statusCode:400});}
}
export function nextScheduleRun({frequency,hour,minute,dayOfWeek,timezone},from=new Date()){
  const zone=validateTimezone(timezone);
  if(!['daily','weekly'].includes(frequency)||!Number.isInteger(hour)||hour<0||hour>23||!Number.isInteger(minute)||minute<0||minute>59)throw Object.assign(new Error('Frequência ou horário inválido'),{statusCode:400});
  if(frequency==='weekly'&&(!Number.isInteger(dayOfWeek)||dayOfWeek<0||dayOfWeek>6))throw Object.assign(new Error('Dia da semana inválido'),{statusCode:400});
  const local=zonedParts(from,zone);
  for(let offset=0;offset<=8;offset++){
    const date=new Date(Date.UTC(local.year,local.month-1,local.day+offset));
    if(frequency==='weekly'&&date.getUTCDay()!==dayOfWeek)continue;
    const candidate=zonedDate(date.getUTCFullYear(),date.getUTCMonth()+1,date.getUTCDate(),hour,minute,zone);
    if(candidate.getTime()>from.getTime()+1000)return candidate;
  }
  throw Object.assign(new Error('Não foi possível calcular a próxima execução'),{statusCode:400});
}
export const publicSchedule=row=>({...row,variables:json(decrypt(row.variables)),executions:row.executions?.map(execution=>({...execution,variables:undefined,renderedSteps:undefined,results:undefined}))});

export async function runDueRunbookSchedules(now=new Date()){
  const due=await prisma.runbookSchedule.findMany({where:{enabled:true,nextRunAt:{lte:now}},include:{runbook:true,device:true},take:20,orderBy:{nextRunAt:'asc'}});
  for(const schedule of due){
    const nextRunAt=nextScheduleRun(schedule,new Date(now.getTime()+60_000));
    const claimed=await prisma.runbookSchedule.updateMany({where:{id:schedule.id,enabled:true,nextRunAt:schedule.nextRunAt},data:{nextRunAt,lastRunAt:now,lastStatus:'running',lastError:null}});
    if(!claimed.count)continue;
    try{
      if(!schedule.device.isActive||schedule.runbook.status!=='published')throw new Error('Equipamento inativo ou Runbook não publicado');
      const rendered=renderRunbook(definition(schedule.runbook),json(decrypt(schedule.variables)),schedule.device);
      let execution;
      if(schedule.mode==='execution'){
        if(schedule.runbook.riskLevel!=='low')throw new Error('Execução automática permitida somente para Runbook de baixo risco');
        await createSimulation({runbook:schedule.runbook,device:schedule.device,rendered,requestedBy:`agenda:${schedule.name}`,scheduleId:schedule.id});
        execution=await executeRunbook({runbook:schedule.runbook,device:schedule.device,rendered,requestedBy:`agenda:${schedule.name}`,approvedBy:schedule.createdBy,scheduleId:schedule.id});
      }else execution=await createSimulation({runbook:schedule.runbook,device:schedule.device,rendered,requestedBy:`agenda:${schedule.name}`,scheduleId:schedule.id});
      await prisma.runbookSchedule.update({where:{id:schedule.id},data:{lastStatus:execution.status,lastError:execution.error}});
      await notifyRunbookEvent({resourceId:`schedule:${schedule.id}:${now.toISOString()}`,event:execution.status==='completed'?'schedule_completed':'schedule_failed',title:schedule.name,message:`${schedule.runbook.name} em ${schedule.device.name}: ${execution.status}.`,critical:execution.status!=='completed'}).catch(()=>{});
      await logAudit({username:'scheduler',displayName:'Agendador de Runbooks',role:'system',action:schedule.mode,resource:'runbook_schedule',resourceId:schedule.id,status:execution.status==='completed'?'success':'failure',details:{executionId:execution.id,runbookId:schedule.runbookId,deviceId:schedule.deviceId}});
    }catch(error){
      await prisma.runbookSchedule.update({where:{id:schedule.id},data:{lastStatus:'failed',lastError:String(error.message).slice(0,1000)}});
      await notifyRunbookEvent({resourceId:`schedule:${schedule.id}:${now.toISOString()}`,event:'schedule_failed',title:schedule.name,message:error.message,critical:true}).catch(()=>{});
      logger.error(`Falha no agendamento ${schedule.id}: ${error.message}`);
    }
  }
  return due.length;
}

let running=false;
export async function runRunbookScheduleScheduler(){
  if(running)return;running=true;
  try{await runDueRunbookSchedules();}catch(error){logger.error(`Scheduler de Runbooks: ${error.message}`);}finally{running=false;}
}

export const protectScheduleVariables=variables=>encrypt(JSON.stringify(variables||{}));
