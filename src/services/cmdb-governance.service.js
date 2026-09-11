import prisma from '../database/client.js';

const DAY=86400000;
const issue=(code,label,severity,weight,action)=>({code,label,severity,weight,action});

export function assessCmdbAsset(asset,now=new Date()){
  const issues=[];
  const active=!['retired','disposed'].includes(asset.status);
  if(!asset.serialNumber)issues.push(issue('missing_serial','Número de série não informado','medium',12,'Cadastrar o número de série do ativo'));
  if(!asset.managementIp&&!asset.hostname)issues.push(issue('missing_identity','Hostname ou IP de gerência ausente','high',15,'Informar hostname ou IP de gerência'));
  if(!asset.manufacturer||!asset.model)issues.push(issue('missing_model','Fabricante ou modelo incompleto','medium',10,'Completar fabricante e modelo'));
  if(!asset.owner)issues.push(issue('missing_owner','Responsável não definido','medium',10,'Definir o responsável pelo ativo'));
  if(!asset.location&&!asset.siteId)issues.push(issue('missing_location','Localização não definida','low',6,'Informar unidade, sala ou rack'));
  if(active&&asset.deviceId){
    if(!asset.lastInventoryAt)issues.push(issue('inventory_never','Inventário técnico nunca coletado','high',18,'Executar a coleta de inventário'));
    else if(now-new Date(asset.lastInventoryAt)>30*DAY)issues.push(issue('inventory_stale','Inventário técnico desatualizado há mais de 30 dias','high',15,'Executar uma nova coleta de inventário'));
    if(asset.lastInventoryStatus==='failed')issues.push(issue('inventory_failed','Última coleta de inventário falhou','high',15,'Verificar conectividade e credenciais do equipamento'));
  }
  for(const[field,prefix]of [['warrantyUntil','Garantia'],['supportUntil','Suporte']])if(asset[field]){
    const days=Math.ceil((new Date(asset[field])-now)/DAY);
    if(days<0)issues.push(issue(`${field}_expired`,`${prefix} vencido há ${Math.abs(days)} dia(s)`,'high',15,`Revisar renovação de ${prefix.toLowerCase()}`));
    else if(days<=90)issues.push(issue(`${field}_expiring`,`${prefix} vence em ${days} dia(s)`,days<=30?'high':'medium',days<=30?12:7,`Planejar renovação de ${prefix.toLowerCase()}`));
  }
  const relationshipCount=Number(asset._count?.relationshipsFrom||0)+Number(asset._count?.relationshipsTo||0);
  if(active&&asset.criticality==='critical'&&!relationshipCount)issues.push(issue('critical_unmapped','Ativo crítico sem dependências mapeadas','high',15,'Mapear dependências e serviços afetados'));
  const score=Math.max(0,100-issues.reduce((total,row)=>total+row.weight,0));
  return{score,grade:score>=90?'excellent':score>=75?'good':score>=55?'attention':'critical',issues:issues.sort((a,b)=>({high:3,medium:2,low:1}[b.severity]-{high:3,medium:2,low:1}[a.severity])),relationshipCount};
}

export async function cmdbGovernance(tenantId=null){
  const assets=await prisma.cmdbAsset.findMany({where:{...(tenantId&&{tenantId})},include:{tenant:{select:{id:true,name:true}},site:{select:{id:true,name:true}},_count:{select:{relationshipsFrom:true,relationshipsTo:true}}},orderBy:{name:'asc'}}),now=new Date();
  const rows=assets.map(asset=>({...asset,...assessCmdbAsset(asset,now)})).sort((a,b)=>a.score-b.score||a.name.localeCompare(b.name));
  const active=rows.filter(row=>!['retired','disposed'].includes(row.status)),average=active.length?Math.round(active.reduce((sum,row)=>sum+row.score,0)/active.length):100;
  return{generatedAt:now,summary:{assets:rows.length,average,critical:active.filter(row=>row.grade==='critical').length,attention:active.filter(row=>row.grade==='attention').length,highIssues:active.reduce((sum,row)=>sum+row.issues.filter(item=>item.severity==='high').length,0),staleInventory:active.filter(row=>row.issues.some(item=>['inventory_never','inventory_stale','inventory_failed'].includes(item.code))).length},assets:rows};
}
