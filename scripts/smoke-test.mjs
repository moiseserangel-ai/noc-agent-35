import prisma from '../src/database/client.js';
import { generateToken } from '../src/middleware/auth.middleware.js';

let session;
try {
  const admin=await prisma.user.findFirst({where:{role:'admin',isActive:true}});
  if(!admin)throw new Error('Administrador ativo não encontrado');
  session=await prisma.authSession.create({data:{userId:admin.id,ipAddress:'127.0.0.1',userAgent:'production-smoke-test',expiresAt:new Date(Date.now()+300000)}});
  const headers={authorization:`Bearer ${generateToken(admin,session.id)}`};
  const paths=['/api/auth/verify','/api/tasks/stats','/api/tasks?limit=1','/api/devices','/api/reports/incidents?days=7','/api/settings','/api/users','/api/audit?limit=1','/api/backups/status'];
  let failed=false;
  for(const path of paths){const response=await fetch(`http://127.0.0.1:3000${path}`,{headers});console.log(`${response.ok?'OK  ':'FAIL'} ${response.status} ${path}`);if(!response.ok)failed=true;}
  if(failed)process.exitCode=1;
}finally{if(session)await prisma.authSession.delete({where:{id:session.id}}).catch(()=>{});await prisma.$disconnect();}
