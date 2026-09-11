import prisma from '../database/client.js';
import logger from '../utils/logger.js';
import { decrypt, encrypt } from '../utils/crypto.js';
import { createSimulation, executeRunbook, publicExecution, renderRunbook } from './runbook.service.js';
import { logAudit } from './audit.service.js';
import { notifyRunbookEvent } from './notification.service.js';

const parse=value=>{try{return JSON.parse(value);}catch{return{};}};
const definition=row=>({...row,variables:JSON.parse(row.variables||'[]'),steps:JSON.parse(row.steps||'[]')});
const include={runbook:{select:{id:true,name:true,version:true,deviceType:true,riskLevel:true,status:true}},targets:{include:{device:{select:{id:true,name:true,hostname:true,type:true,isActive:true}}},orderBy:{createdAt:'asc'}},executions:{include:{device:{select:{name:true,type:true}}},orderBy:{createdAt:'desc'},take:100}};
export const publicBatch=row=>({...row,variables:parse(decrypt(row.variables)),executions:row.executions?.map(publicExecution)});
export const shouldStopBatch=(failed,processed,threshold=20)=>processed>0&&failed/processed*100>=threshold;

export async function createRunbookBatch({name,runbook,devices,variables,createdBy}){
  const unique=[...new Map(devices.map(device=>[device.id,device])).values()];
  if(unique.length<2||unique.length>50)throw Object.assign(new Error('Selecione entre 2 e 50 equipamentos'),{statusCode:400});
  for(const device of unique){
    if(!device.isActive)throw Object.assign(new Error(`${device.name} está inativo`),{statusCode:400});
    if(runbook.deviceType!=='any'&&runbook.deviceType!==device.type)throw Object.assign(new Error(`${device.name} é incompatível com o Runbook`),{statusCode:400});
    renderRunbook(definition(runbook),variables,device);
  }
  return prisma.runbookBatch.create({data:{name:String(name||`${runbook.name} · lote`).trim().slice(0,120),runbookId:runbook.id,variables:encrypt(JSON.stringify(variables||{})),totalTargets:unique.length,createdBy,targets:{create:unique.map(device=>({deviceId:device.id}))}},include});
}

export async function simulateRunbookBatch(id,actor){
  const batch=await prisma.runbookBatch.findUnique({where:{id},include:{runbook:true,targets:{include:{device:true}}}});
  if(!batch)throw Object.assign(new Error('Lote não encontrado'),{statusCode:404});
  if(!['draft','simulated'].includes(batch.status))throw Object.assign(new Error('Lote não pode ser simulado no estado atual'),{statusCode:409});
  const values=parse(decrypt(batch.variables));let simulated=0;let failed=0;
  for(const target of batch.targets){
    try{
      const rendered=renderRunbook(definition(batch.runbook),values,target.device);
      const execution=await createSimulation({runbook:batch.runbook,device:target.device,rendered,requestedBy:actor,batchId:batch.id});
      await prisma.runbookBatchTarget.update({where:{id:target.id},data:{status:'simulated',simulationExecutionId:execution.id,error:null,completedAt:new Date()}});simulated++;
    }catch(error){await prisma.runbookBatchTarget.update({where:{id:target.id},data:{status:'failed',error:String(error.message).slice(0,1000),completedAt:new Date()}});failed++;}
  }
  return prisma.runbookBatch.update({where:{id:batch.id},data:{status:simulated?'simulated':'failed',simulatedTargets:simulated,failedTargets:failed,simulatedAt:new Date()},include});
}

async function executeTarget(batch,target,values,actor){
  await prisma.runbookBatchTarget.update({where:{id:target.id},data:{status:'running',startedAt:new Date(),error:null}});
  try{
    const rendered=renderRunbook(definition(batch.runbook),values,target.device);
    const execution=await executeRunbook({runbook:batch.runbook,device:target.device,rendered,requestedBy:actor,approvedBy:actor,batchId:batch.id});
    const success=execution.status==='completed';
    await prisma.runbookBatchTarget.update({where:{id:target.id},data:{status:success?'completed':'failed',executionId:execution.id,error:execution.error,completedAt:new Date()}});
    return success;
  }catch(error){
    await prisma.runbookBatchTarget.update({where:{id:target.id},data:{status:'failed',error:String(error.message).slice(0,1000),completedAt:new Date()}});
    return false;
  }
}

export async function processRunbookBatch(id,actor){
  const batch=await prisma.runbookBatch.findUnique({where:{id},include:{runbook:true,targets:{where:{status:'simulated'},include:{device:true},orderBy:{createdAt:'asc'}}}});
  if(!batch)return;
  const values=parse(decrypt(batch.variables));let success=0;let failed=0;let processed=0;let stopped=false;
  try{
    for(let index=0;index<batch.targets.length;index+=batch.concurrency){
      if(shouldStopBatch(failed,processed,batch.failureThreshold)){stopped=true;break;}
      const wave=batch.targets.slice(index,index+batch.concurrency);
      const results=await Promise.all(wave.map(target=>executeTarget(batch,target,values,actor)));
      success+=results.filter(Boolean).length;failed+=results.filter(result=>!result).length;processed+=results.length;
      await prisma.runbookBatch.update({where:{id:batch.id},data:{succeededTargets:success,failedTargets:failed}});
    }
    const remaining=batch.targets.length-processed;
    if(remaining)await prisma.runbookBatchTarget.updateMany({where:{batchId:batch.id,status:'simulated'},data:{status:'skipped',error:'Interrompido pelo limite de falhas',completedAt:new Date()}});
    const status=stopped?'stopped':failed?'completed':'completed';
    await prisma.runbookBatch.update({where:{id:batch.id},data:{status,succeededTargets:success,failedTargets:failed,skippedTargets:remaining,completedAt:new Date()}});
    await notifyRunbookEvent({resourceId:`batch:${batch.id}`,event:stopped?'batch_stopped':'batch_completed',title:batch.name,message:`Sucesso: ${success}; falhas: ${failed}; ignorados: ${remaining}.`,critical:stopped||failed>0}).catch(()=>{});
    await logAudit({username:actor,displayName:actor,role:'admin',action:'execute',resource:'runbook_batch',resourceId:batch.id,status:failed?'failure':'success',details:{success,failed,skipped:remaining,stopped}});
  }catch(error){
    logger.error(`Falha no lote ${batch.id}: ${error.message}`);
    await prisma.runbookBatch.update({where:{id:batch.id},data:{status:'failed',completedAt:new Date()}});
  }
}

export async function startRunbookBatch(id,actor){
  const batch=await prisma.runbookBatch.findUnique({where:{id}});
  if(!batch)throw Object.assign(new Error('Lote não encontrado'),{statusCode:404});
  if(batch.status!=='simulated'||!batch.simulatedAt||batch.simulatedAt<new Date(Date.now()-30*60_000))throw Object.assign(new Error('Simule o lote nos últimos 30 minutos antes da execução'),{statusCode:409});
  const claimed=await prisma.runbookBatch.updateMany({where:{id,status:'simulated'},data:{status:'running',approvedBy:actor,startedAt:new Date(),succeededTargets:0,failedTargets:0,skippedTargets:0}});
  if(!claimed.count)throw Object.assign(new Error('Lote já iniciado'),{statusCode:409});
  setImmediate(()=>processRunbookBatch(id,actor));
  return prisma.runbookBatch.findUnique({where:{id},include});
}

export async function resumeInterruptedBatches(){
  const result=await prisma.runbookBatch.updateMany({where:{status:'running'},data:{status:'stopped',completedAt:new Date()}});
  if(result.count)await prisma.runbookBatchTarget.updateMany({where:{batch:{status:'stopped'},status:{in:['running','simulated']}},data:{status:'skipped',error:'Execução interrompida por reinicialização do serviço',completedAt:new Date()}});
}

export const getRunbookBatch=id=>prisma.runbookBatch.findUnique({where:{id},include});
export const listRunbookBatches=()=>prisma.runbookBatch.findMany({include:{runbook:{select:{name:true,version:true,riskLevel:true}},targets:{select:{status:true}}},orderBy:{createdAt:'desc'},take:100});
