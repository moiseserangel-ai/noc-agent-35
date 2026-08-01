import prisma from '../database/client.js';
import { notifyCmdbLifecycleAlert } from './notification.service.js';

const DAY=86400000;
const expiry=(asset,field,type,label,now)=>{if(!asset[field])return null;const days=Math.ceil((new Date(asset[field])-now)/DAY);if(days>90)return null;const stage=days<0?'expired':days<=7?'7d':days<=30?'30d':'90d',severity=days<0||days<=7?'critical':days<=30?'high':'medium';return{type,stage,severity,title:`${label} ${days<0?'vencida':'próxima do vencimento'} — ${asset.name}`,message:days<0?`${label} do ativo ${asset.assetTag} venceu há ${Math.abs(days)} dia(s).`:`${label} do ativo ${asset.assetTag} vence em ${days} dia(s), em ${new Date(asset[field]).toLocaleDateString('pt-BR')}.`};};

export function evaluateLifecycleAsset(asset,now=new Date()){
  if(['retired','disposed'].includes(asset.status))return[];const alerts=[expiry(asset,'warrantyUntil','warranty','Garantia',now),expiry(asset,'supportUntil','support','Contrato de suporte',now),expiry(asset,'licenseUntil','license','Licença',now)].filter(Boolean);
  if(asset.deviceId&&asset.lastInventoryStatus==='failed')alerts.push({type:'inventory',stage:'failed',severity:'high',title:`Falha no inventário — ${asset.name}`,message:`A última coleta técnica de ${asset.assetTag} falhou: ${asset.lastInventoryError||'erro não informado'}.`});
  else if(asset.deviceId&&!asset.lastInventoryAt)alerts.push({type:'inventory',stage:'never',severity:'high',title:`Inventário pendente — ${asset.name}`,message:`O ativo ${asset.assetTag} ainda não possui coleta técnica.`});
  else if(asset.deviceId&&now-new Date(asset.lastInventoryAt)>30*DAY)alerts.push({type:'inventory',stage:'stale',severity:'high',title:`Inventário desatualizado — ${asset.name}`,message:`A coleta técnica do ativo ${asset.assetTag} está há mais de 30 dias sem atualização.`});
  if(!asset.owner)alerts.push({type:'owner',stage:'missing',severity:'medium',title:`Ativo sem responsável — ${asset.name}`,message:`Defina um responsável para o ativo ${asset.assetTag}.`});
  if(asset.criticality==='critical'&&!Number(asset._count?.relationshipsFrom||0)&&!Number(asset._count?.relationshipsTo||0))alerts.push({type:'dependency',stage:'unmapped',severity:'high',title:`Ativo crítico sem dependências — ${asset.name}`,message:`Mapeie os serviços e ativos dependentes de ${asset.assetTag}.`});
  if(asset.status==='maintenance'&&now-new Date(asset.updatedAt)>30*DAY)alerts.push({type:'maintenance',stage:'overdue',severity:'medium',title:`Manutenção prolongada — ${asset.name}`,message:`O ativo ${asset.assetTag} permanece em manutenção há mais de 30 dias.`});return alerts;
}

export async function runCmdbLifecycleMonitor(io=null){
  const assets=await prisma.cmdbAsset.findMany({include:{_count:{select:{relationshipsFrom:true,relationshipsTo:true}}}}),now=new Date(),activeKeys=new Set(),notifications=[];
  for(const asset of assets)for(const condition of evaluateLifecycleAsset(asset,now)){const key=`${asset.id}:${condition.type}`;activeKeys.add(key);const current=await prisma.cmdbLifecycleAlert.findUnique({where:{assetId_type:{assetId:asset.id,type:condition.type}}}),stageChanged=current?.status!=='active'||current?.notificationStage!==condition.stage;const alert=await prisma.cmdbLifecycleAlert.upsert({where:{assetId_type:{assetId:asset.id,type:condition.type}},update:{...condition,status:'active',lastSeenAt:now,resolvedAt:null},create:{assetId:asset.id,...condition}});if(stageChanged){await notifyCmdbLifecycleAlert(alert,io);await prisma.cmdbLifecycleAlert.update({where:{id:alert.id},data:{notificationStage:condition.stage}});notifications.push(alert.id);}}
  const open=await prisma.cmdbLifecycleAlert.findMany({where:{status:'active'}});for(const alert of open)if(!activeKeys.has(`${alert.assetId}:${alert.type}`))await prisma.cmdbLifecycleAlert.update({where:{id:alert.id},data:{status:'resolved',resolvedAt:now,lastSeenAt:now}});
  return{assets:assets.length,active:activeKeys.size,notifications:notifications.length,resolved:open.filter(alert=>!activeKeys.has(`${alert.assetId}:${alert.type}`)).length};
}

export async function listCmdbLifecycleAlerts(status='active'){return prisma.cmdbLifecycleAlert.findMany({where:status==='all'?{}:{status},include:{asset:{select:{id:true,assetTag:true,name:true,criticality:true,tenant:{select:{name:true}}}}},orderBy:[{status:'asc'},{severity:'asc'},{updatedAt:'desc'}],take:500});}
