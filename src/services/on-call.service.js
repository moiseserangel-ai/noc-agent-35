import prisma from '../database/client.js';

const minute=value=>{const [hour,min]=String(value).split(':').map(Number);return hour*60+min;};
export const validTime=value=>/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value));

export function localScheduleParts(now,timeZone){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).filter(item=>item.type!=='literal').map(item=>[item.type,item.value]));
  return{day:{Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6}[parts.weekday],minute:Number(parts.hour)*60+Number(parts.minute)};
}

export function shiftIsActive(shift,now=new Date(),timeZone='America/Porto_Velho'){
  if(!shift.enabled)return false;
  const local=localScheduleParts(now,timeZone),start=minute(shift.startTime),end=minute(shift.endTime),day=Number(shift.dayOfWeek);
  if(start<end)return local.day===day&&local.minute>=start&&local.minute<end;
  return(local.day===day&&local.minute>=start)||(local.day===(day+1)%7&&local.minute<end);
}

const publicTeam=team=>({
  ...team,
  members:team.members.map(member=>({...member,user:{id:member.user.id,name:member.user.name,username:member.user.username,role:member.user.role}})),
  shifts:team.shifts.map(shift=>({...shift,user:{id:shift.user.id,name:shift.user.name,username:shift.user.username}})),
  overrides:team.overrides.map(item=>({...item,user:{id:item.user.id,name:item.user.name,username:item.user.username}})),
});

export async function getOnCallOverview(now=new Date()){
  const teams=await prisma.onCallTeam.findMany({
    orderBy:{name:'asc'},
    include:{
      members:{orderBy:{priority:'asc'},include:{user:true}},
      shifts:{orderBy:[{dayOfWeek:'asc'},{startTime:'asc'}],include:{user:true}},
      overrides:{where:{endsAt:{gte:new Date(now.getTime()-24*60*60_000)}},orderBy:{startsAt:'asc'},include:{user:true}},
    },
  });
  return teams.map(team=>{
    const override=team.overrides.find(item=>item.startsAt<=now&&item.endsAt>now&&item.user.isActive);
    const activeIds=override?[override.userId]:team.shifts.filter(shift=>shift.user.isActive&&shiftIsActive(shift,now,team.timezone)).map(shift=>shift.userId);
    const activeMembers=team.members.filter(member=>member.enabled&&member.user.isActive&&activeIds.includes(member.userId));
    return{...publicTeam(team),activeMembers:activeMembers.map(member=>({id:member.id,userId:member.userId,name:member.user.name,telegramChatId:member.telegramChatId,whatsappNumber:member.whatsappNumber,priority:member.priority})),activeOverrideId:override?.id||null};
  });
}

export async function resolveOnCallContacts(now=new Date()){
  const teams=(await getOnCallOverview(now)).filter(team=>team.enabled);
  const members=teams.flatMap(team=>team.activeMembers.map(member=>({...member,teamId:team.id,teamName:team.name})));
  return{
    members,
    telegram:[...new Set(members.map(member=>member.telegramChatId).filter(Boolean))],
    whatsapp:[...new Set(members.map(member=>member.whatsappNumber).filter(Boolean))],
  };
}

export function validateTimezone(value){
  const timezone=String(value||'America/Porto_Velho');try{new Intl.DateTimeFormat('pt-BR',{timeZone:timezone}).format();}catch{throw Object.assign(new Error('Fuso horário inválido'),{statusCode:400});}return timezone;
}
