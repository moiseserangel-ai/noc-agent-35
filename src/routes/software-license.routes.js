import {Router} from 'express';
import prisma from '../database/client.js';
import {logAudit,requestIdentity} from '../services/audit.service.js';
import {createRenewalTask,runCommercialExpiryMonitor} from '../services/commercial-expiry.service.js';

const router=Router();
const bad=message=>Object.assign(new Error(message),{statusCode:400});
const text=(value,max=255)=>String(value||'').trim().slice(0,max)||null;
const optionalDate=value=>{if(!value)return null;const raw=String(value),date=value instanceof Date?value:new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw)?`${raw}T12:00:00Z`:raw);if(Number.isNaN(date.getTime()))throw bad('Informe datas válidas');return date;};

export function licenseHealth(row,now=new Date()){
  if(row.status!=='active')return{state:row.status,daysRemaining:null};
  if(!row.expiresAt)return{state:'perpetual',daysRemaining:null};
  const days=Math.ceil((new Date(row.expiresAt)-now)/86400000);
  return{state:days<0?'expired':days<=Number(row.noticeDays||30)?'expiring':'healthy',daysRemaining:days};
}

export function normalizeSoftwareLicense(input){
  const name=text(input.name,180),product=text(input.product,180),tenantId=text(input.tenantId,80);
  if(!name||!product||!tenantId)throw bad('Informe nome, produto e empresa');
  const seatsPurchased=Math.max(1,Math.floor(Number(input.seatsPurchased)||1));
  const seatsUsed=Math.max(0,Math.floor(Number(input.seatsUsed)||0));
  if(seatsUsed>seatsPurchased)throw bad('Licenças em uso não podem superar a quantidade contratada');
  const amount=input.amount===''||input.amount==null?null:Number(input.amount);
  if(amount!==null&&(!Number.isFinite(amount)||amount<0))throw bad('Valor inválido');
  const portalUrl=text(input.portalUrl,700);
  if(portalUrl&&!/^https:\/\//i.test(portalUrl))throw bad('O portal deve usar URL HTTPS');
  const startDate=optionalDate(input.startDate),expiresAt=optionalDate(input.expiresAt);
  if(startDate&&expiresAt&&expiresAt<startDate)throw bad('O vencimento deve ser posterior ao início');
  return{name,product,tenantId,vendor:text(input.vendor,120),edition:text(input.edition,120),supplierId:text(input.supplierId,80),contractId:text(input.contractId,80),licenseType:['subscription','perpetual','volume','trial','support'].includes(input.licenseType)?input.licenseType:'subscription',status:['active','inactive','suspended','cancelled'].includes(input.status)?input.status:'active',reference:text(input.reference,160),keyLast4:text(input.keyLast4,4),seatsPurchased,seatsUsed,startDate,expiresAt,renewalType:['manual','automatic','none'].includes(input.renewalType)?input.renewalType:'manual',noticeDays:Math.min(365,Math.max(0,Math.floor(Number(input.noticeDays)||30))),amount,currency:['BRL','USD','EUR'].includes(input.currency)?input.currency:'BRL',billingCycle:['monthly','quarterly','annual','one_time'].includes(input.billingCycle)?input.billingCycle:'annual',owner:text(input.owner),ownerEmail:text(input.ownerEmail),portalUrl,notes:text(input.notes,2000),assetIds:[...new Set((input.assetIds||[]).map(String).filter(Boolean))]};
}

const include={tenant:{select:{id:true,name:true}},supplier:{select:{id:true,name:true}},contract:{select:{id:true,number:true,title:true}},assets:{include:{asset:{select:{id:true,assetTag:true,name:true,manufacturer:true,model:true}}}}};
const publicRow=row=>({...row,...licenseHealth(row),utilizationPercent:Math.round((row.seatsUsed/Math.max(row.seatsPurchased,1))*100)});

async function validateReferences(data,assetIds){
  const [tenant,supplier,contract,assetCount]=await Promise.all([
    prisma.tenant.findUnique({where:{id:data.tenantId},select:{id:true}}),
    data.supplierId?prisma.supplier.findFirst({where:{id:data.supplierId,status:'active',OR:[{tenantId:null},{tenantId:data.tenantId}]},select:{id:true}}):true,
    data.contractId?prisma.commercialContract.findFirst({where:{id:data.contractId,tenantId:data.tenantId},select:{id:true}}):true,
    assetIds.length?prisma.cmdbAsset.count({where:{id:{in:assetIds},tenantId:data.tenantId}}):0
  ]);
  if(!tenant)throw bad('Empresa não encontrada');
  if(!supplier)throw bad('Fornecedor inválido para esta empresa');
  if(!contract)throw bad('Contrato inválido para esta empresa');
  if(assetCount!==assetIds.length)throw bad('Um ou mais ativos não pertencem à empresa selecionada');
}

router.get('/summary',async(req,res,next)=>{try{const rows=await prisma.softwareLicense.findMany({where:req.query.tenantId?{tenantId:String(req.query.tenantId)}:{},select:{status:true,expiresAt:true,noticeDays:true,seatsPurchased:true,seatsUsed:true,amount:true,currency:true}}),data=rows.map(publicRow);res.json({success:true,data:{total:data.length,active:data.filter(x=>x.status==='active').length,expired:data.filter(x=>x.state==='expired').length,expiring:data.filter(x=>x.state==='expiring').length,seatsPurchased:data.reduce((n,x)=>n+x.seatsPurchased,0),seatsUsed:data.reduce((n,x)=>n+x.seatsUsed,0)}});}catch(error){next(error);}});
router.get('/automation',async(req,res,next)=>{try{const row=await prisma.settings.findUnique({where:{key:'commercial_expiry_auto_tasks'}});res.json({success:true,data:{autoTasks:row?.value==='true'}});}catch(error){next(error);}});
router.put('/automation',async(req,res,next)=>{try{const value=req.body.autoTasks===true?'true':'false';await prisma.settings.upsert({where:{key:'commercial_expiry_auto_tasks'},update:{value,encrypted:false},create:{key:'commercial_expiry_auto_tasks',value,encrypted:false}});await logAudit({...requestIdentity(req),action:'configure_automation',resource:'commercial_expiry',status:'success',details:{autoTasks:value==='true'}});res.json({success:true,data:{autoTasks:value==='true'},message:'Automação de renovações atualizada'});}catch(error){next(error);}});
router.post('/monitor',async(req,res,next)=>{try{res.json({success:true,data:await runCommercialExpiryMonitor(req.app.get('io')),message:'Vencimentos verificados'});}catch(error){next(error);}});
router.get('/',async(req,res,next)=>{try{const where={...(req.query.status&&req.query.status!=='all'&&{status:String(req.query.status)}),...(req.query.tenantId&&{tenantId:String(req.query.tenantId)})},rows=await prisma.softwareLicense.findMany({where,include,orderBy:[{expiresAt:'asc'},{name:'asc'}],take:1000});res.json({success:true,data:rows.map(publicRow)});}catch(error){next(error);}});
router.post('/',async(req,res,next)=>{try{const data=normalizeSoftwareLicense(req.body),assetIds=data.assetIds,actor=String(req.user.name||req.user.username);delete data.assetIds;await validateReferences(data,assetIds);const row=await prisma.softwareLicense.create({data:{...data,createdBy:actor,updatedBy:actor,assets:{create:assetIds.map(assetId=>({assetId}))}},include});await logAudit({...requestIdentity(req),action:'create',resource:'software_license',resourceId:row.id,status:'success',details:{product:row.product,seats:row.seatsPurchased,expiresAt:row.expiresAt}});res.status(201).json({success:true,data:publicRow(row),message:'Licença cadastrada'});}catch(error){next(error);}});
router.post('/:id/renewal-task',async(req,res,next)=>{try{const result=await createRenewalTask('license',req.params.id,String(req.user.name||req.user.username),req.app.get('io'));res.status(result.created?201:200).json({success:true,data:result.task,message:result.created?`Task #${result.task.taskNumber} criada`:`Task #${result.task.taskNumber} já acompanha esta renovação`});}catch(error){next(error);}});
router.put('/:id',async(req,res,next)=>{try{const current=await prisma.softwareLicense.findUnique({where:{id:req.params.id},include:{assets:{select:{assetId:true}}}});if(!current)return res.status(404).json({success:false,error:'Licença não encontrada'});const data=normalizeSoftwareLicense({...current,assetIds:current.assets.map(x=>x.assetId),...req.body}),assetIds=data.assetIds;delete data.assetIds;await validateReferences(data,assetIds);const row=await prisma.$transaction(async tx=>{await tx.softwareLicenseAsset.deleteMany({where:{licenseId:current.id}});return tx.softwareLicense.update({where:{id:current.id},data:{...data,updatedBy:String(req.user.name||req.user.username),assets:{create:assetIds.map(assetId=>({assetId}))}},include});});await logAudit({...requestIdentity(req),action:'update',resource:'software_license',resourceId:row.id,status:'success',details:{before:{status:current.status,seatsUsed:current.seatsUsed,expiresAt:current.expiresAt},after:{status:row.status,seatsUsed:row.seatsUsed,expiresAt:row.expiresAt}}});res.json({success:true,data:publicRow(row),message:'Licença atualizada'});}catch(error){next(error);}});

export default router;
