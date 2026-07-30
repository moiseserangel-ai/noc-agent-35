import crypto from 'node:crypto';
import prisma from '../database/client.js';
import { classifyCliCommand, executeManagedDeviceCommand } from './cli.service.js';
import { decrypt, encrypt } from '../utils/crypto.js';

const safeJson=(value,fallback)=>{try{return JSON.parse(value);}catch{return fallback;}};
const protectedJson=(value,fallback)=>safeJson(decrypt(value),fallback);
const clean=(value,max=4000)=>String(value??'').trim().slice(0,max);
const keyPattern=/^[a-z][a-z0-9_]{1,39}$/;
const allowedCategories=['diagnostic','network','security','monitoring','maintenance','custom'];

export function validateRunbookDefinition(input){
  const variables=Array.isArray(input.variables)?input.variables:[];
  const steps=Array.isArray(input.steps)?input.steps:[];
  if(clean(input.name,120).length<4)throw Object.assign(new Error('Nome do runbook deve ter pelo menos 4 caracteres'),{statusCode:400});
  if(clean(input.description,2000).length<10)throw Object.assign(new Error('Descreva o objetivo do runbook'),{statusCode:400});
  if(variables.length>20)throw Object.assign(new Error('Runbook aceita no máximo 20 variáveis'),{statusCode:400});
  if(!steps.length||steps.length>30)throw Object.assign(new Error('Runbook deve conter entre 1 e 30 etapas'),{statusCode:400});
  const keys=new Set();
  const normalizedVariables=variables.map(item=>{
    const key=clean(item.key,40);
    if(!keyPattern.test(key)||keys.has(key))throw Object.assign(new Error(`Variável inválida ou duplicada: ${key||'(vazia)'}`),{statusCode:400});
    if(item.secret)throw Object.assign(new Error(`Variáveis secretas ainda não são aceitas em runbooks: ${key}`),{statusCode:400});
    keys.add(key);
    let pattern=null;
    if(item.pattern){try{new RegExp(item.pattern);pattern=clean(item.pattern,200);}catch{throw Object.assign(new Error(`Expressão inválida na variável ${key}`),{statusCode:400});}}
    return{key,label:clean(item.label,80)||key,required:item.required!==false,default:clean(item.default,500),pattern};
  });
  const normalizedSteps=steps.map((item,index)=>{
    const command=clean(item.command,8000);
    if(!command)throw Object.assign(new Error(`Etapa ${index+1} não possui comando`),{statusCode:400});
    return{id:item.id||crypto.randomUUID(),name:clean(item.name,100)||`Etapa ${index+1}`,deviceType:clean(item.deviceType,40)||'any',command,validation:clean(item.validation,8000),rollback:clean(item.rollback,8000),continueOnError:Boolean(item.continueOnError)};
  });
  return{name:clean(input.name,120),description:clean(input.description,2000),category:allowedCategories.includes(input.category)?input.category:'custom',deviceType:clean(input.deviceType,40)||'any',variables:normalizedVariables,steps:normalizedSteps};
}

export function renderRunbook(definition,values,device){
  const resolved={};
  for(const variable of definition.variables){
    const value=clean(values?.[variable.key]??variable.default,500);
    if(variable.required&&!value)throw Object.assign(new Error(`Informe ${variable.label}`),{statusCode:400});
    if(variable.pattern&&value&&!new RegExp(variable.pattern).test(value))throw Object.assign(new Error(`Valor inválido para ${variable.label}`),{statusCode:400});
    resolved[variable.key]=value;
  }
  const replace=template=>String(template||'').replace(/\{\{([a-z][a-z0-9_]*)\}\}/gi,(_,key)=>{
    if(!(key in resolved))throw Object.assign(new Error(`Variável não definida: ${key}`),{statusCode:400});
    return resolved[key];
  });
  const steps=definition.steps.filter(step=>step.deviceType==='any'||step.deviceType===device.type).map(step=>({
    ...step,command:replace(step.command),validation:replace(step.validation),rollback:replace(step.rollback),
  }));
  if(!steps.length)throw Object.assign(new Error('Nenhuma etapa deste runbook é compatível com o equipamento'),{statusCode:400});
  const inspected=steps.map(step=>{
    const commandPolicy=classifyCliCommand(device.type,step.command);
    if(!commandPolicy.valid)throw Object.assign(new Error(`${step.name}: ${commandPolicy.reason}`),{statusCode:400});
    const validationPolicy=step.validation?classifyCliCommand(device.type,step.validation):null;
    if(validationPolicy&&!validationPolicy.valid)throw Object.assign(new Error(`${step.name} (validação): ${validationPolicy.reason}`),{statusCode:400});
    const rollbackPolicy=step.rollback?classifyCliCommand(device.type,step.rollback):null;
    if(rollbackPolicy&&!rollbackPolicy.valid)throw Object.assign(new Error(`${step.name} (rollback): ${rollbackPolicy.reason}`),{statusCode:400});
    return{...step,commandType:commandPolicy.type,validationType:validationPolicy?.type||null,rollbackType:rollbackPolicy?.type||null};
  });
  return{variables:resolved,steps:inspected,hasChanges:inspected.some(step=>step.commandType==='change')};
}

export const runbookInputHash=(runbookId,deviceId,variables)=>crypto.createHash('sha256').update(JSON.stringify({runbookId,deviceId,variables:Object.keys(variables).sort().map(key=>[key,variables[key]])})).digest('hex');
export function assessRunbookRisk(definition){
  let hasChange=false;let missingRollback=false;let unknown=false;
  for(const step of definition.steps){
    const type=step.deviceType!=='any'?step.deviceType:definition.deviceType;
    const policy=type&&type!=='any'?classifyCliCommand(type,step.command):null;
    if(!policy?.valid){unknown=true;continue;}
    if(policy.type==='change'){hasChange=true;if(!step.rollback)missingRollback=true;}
  }
  if(unknown||missingRollback)return'critical';
  return hasChange?'high':'low';
}
export const publicRunbook=row=>({...row,variables:safeJson(row.variables,[]),steps:safeJson(row.steps,[]),executions:row.executions?.map(publicExecution)});
export const publicExecution=row=>({...row,variables:protectedJson(row.variables,{}),renderedSteps:protectedJson(row.renderedSteps,[]),results:protectedJson(row.results,[])});

export function createSimulation({runbook,device,rendered,requestedBy,taskId=null}){
  const inputHash=runbookInputHash(runbook.id,device.id,rendered.variables);
  return prisma.runbookExecution.create({data:{runbookId:runbook.id,deviceId:device.id,taskId,mode:'simulation',status:'completed',inputHash,variables:encrypt(JSON.stringify(rendered.variables)),renderedSteps:encrypt(JSON.stringify(rendered.steps)),results:encrypt(JSON.stringify(rendered.steps.map(step=>({stepId:step.id,name:step.name,commandType:step.commandType,validationType:step.validationType,rollbackAvailable:Boolean(step.rollback),status:'simulated'})))),requestedBy,completedAt:new Date()}});
}

export async function executeRunbook({runbook,device,rendered,requestedBy,approvedBy,taskId=null}){
  const hash=runbookInputHash(runbook.id,device.id,rendered.variables);
  const execution=await prisma.runbookExecution.create({data:{runbookId:runbook.id,deviceId:device.id,taskId,mode:'execution',status:'running',inputHash:hash,variables:encrypt(JSON.stringify(rendered.variables)),renderedSteps:encrypt(JSON.stringify(rendered.steps)),requestedBy,approvedBy,startedAt:new Date()}});
  const results=[];let failed=false;
  for(const step of rendered.steps){
    const startedAt=new Date();
    const result=await executeManagedDeviceCommand({device,command:step.command,changeComment:`Runbook ${runbook.name} v${runbook.version}: ${step.name}`,approved:true,agentName:`runbook:${runbook.name}`});
    let validation=null;
    if(result.success&&step.validation)validation=await executeManagedDeviceCommand({device,command:step.validation,changeComment:`Validação do runbook ${runbook.name}`,approved:false,agentName:`runbook:${runbook.name}`});
    const passed=result.success&&(!validation||validation.success);
    results.push({stepId:step.id,name:step.name,commandType:step.commandType,success:passed,output:String(result.output||'').slice(0,20000),validation:validation?{success:validation.success,output:String(validation.output||'').slice(0,20000)}:null,startedAt,completedAt:new Date()});
    if(!passed){failed=true;if(!step.continueOnError)break;}
  }
  return prisma.runbookExecution.update({where:{id:execution.id},data:{status:failed?'failed':'completed',results:encrypt(JSON.stringify(results)),completedAt:new Date(),error:failed?'Uma ou mais etapas falharam':null}});
}

export async function rollbackRunbook({execution,device,requestedBy}){
  const steps=protectedJson(execution.renderedSteps,[]).filter(step=>step.rollback).reverse();
  if(!steps.length)throw Object.assign(new Error('Esta execução não possui etapas de rollback'),{statusCode:400});
  const rollback=await prisma.runbookExecution.create({data:{runbookId:execution.runbookId,deviceId:device.id,mode:'rollback',status:'running',inputHash:execution.inputHash,variables:execution.variables,renderedSteps:encrypt(JSON.stringify(steps)),requestedBy,approvedBy:requestedBy,startedAt:new Date()}});
  const results=[];let failed=false;
  for(const step of steps){
    const result=await executeManagedDeviceCommand({device,command:step.rollback,changeComment:`Rollback do runbook: ${step.name}`,approved:true,agentName:'runbook:rollback'});
    results.push({stepId:step.id,name:step.name,success:result.success,output:String(result.output||'').slice(0,20000)});
    if(!result.success){failed=true;break;}
  }
  return prisma.runbookExecution.update({where:{id:rollback.id},data:{status:failed?'failed':'completed',results:encrypt(JSON.stringify(results)),completedAt:new Date(),error:failed?'Rollback falhou':null}});
}
