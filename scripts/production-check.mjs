import 'dotenv/config';
import { stat } from 'node:fs/promises';
import prisma from '../src/database/client.js';
import { listBackups, verifyBackup, safeBackupPath } from '../src/services/backup.service.js';

const checks=[];
const add=(name,ok,detail='')=>checks.push({name,ok:Boolean(ok),detail});
try {
  add('NODE_ENV',process.env.NODE_ENV==='production','deve ser production');
  add('ENCRYPTION_KEY',/^[0-9a-fA-F]{64,}$/.test(process.env.ENCRYPTION_KEY||''),'mínimo 64 hex');
  add('JWT_SECRET',(process.env.JWT_SECRET||'').length>=32&&process.env.JWT_SECRET!=='default-jwt-secret','mínimo 32 caracteres');
  add('ALLOWED_ORIGINS',Boolean(process.env.ALLOWED_ORIGINS),'origens explícitas');
  add('Webhook Evolution',(process.env.EVOLUTION_WEBHOOK_TOKEN||'').length>=16,'token configurado');
  add('Webhook Zabbix',(process.env.ZABBIX_WEBHOOK_TOKEN||'').length>=16,'token configurado');
  const integrity=await prisma.$queryRawUnsafe('PRAGMA integrity_check');
  add('Integridade SQLite',integrity.flatMap(Object.values).some(x=>String(x).toLowerCase()==='ok'));
  const [users,admin]=await Promise.all([prisma.user.count(),prisma.user.findFirst({where:{role:'admin',isActive:true}})]);
  add('Usuários',users>0,`${users} cadastrado(s)`); add('Administrador ativo',Boolean(admin));
  const backups=await listBackups();
  if(backups[0]){await verifyBackup(safeBackupPath(backups[0].filename));add('Último backup',true,backups[0].filename);}else add('Último backup',false,'nenhum backup');
  const envInfo=await stat('.env'); add('Permissão .env',(envInfo.mode&0o077)===0,(envInfo.mode&0o777).toString(8));
  const health=await fetch('http://127.0.0.1:3000/api/health').then(r=>r.json()).catch(()=>null);add('API local',health?.status==='ok');
} catch(error){add('Execução',false,error.message);} finally {await prisma.$disconnect();}
for(const item of checks)console.log(`${item.ok?'OK  ':'FAIL'} ${item.name}${item.detail?` — ${item.detail}`:''}`);
if(checks.some(item=>!item.ok))process.exitCode=1;
