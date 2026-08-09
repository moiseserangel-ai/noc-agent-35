import { Router } from 'express';
import prisma from '../database/client.js';
import { createKnowledgeDocument, createKnowledgeImportJob, discoverRelatedPages, KNOWLEDGE_SCOPES, searchKnowledge, updateKnowledgeDocument } from '../services/knowledge.service.js';

const router = Router();

async function knowledgeTenantId(value) {
  if (value === undefined || value === null || value === '') return null;
  const tenant = await prisma.tenant.findFirst({ where: { id: String(value), isActive: true }, select: { id: true } });
  if (!tenant) throw new Error('Cliente inválido ou inativo');
  return tenant.id;
}

router.post('/crawl/discover', async (req, res, next) => {
  try {
    const result = await discoverRelatedPages(String(req.body.startUrl || ''), { maxDepth: req.body.maxDepth, maxPages: req.body.maxPages });
    res.json({ success: true, data: result });
  } catch (error) {
    if (/URL|HTTPS|link|página|docs|Huawei|catálogo|seção|rede privada|HTTP|conexão|limite|conteúdo/i.test(error.message)) return res.status(400).json({ success: false, error: error.message });
    next(error);
  }
});

router.post('/crawl/import', async (req, res, next) => {
  try {
    const tenantId = await knowledgeTenantId(req.body.tenantId);
    const job = await createKnowledgeImportJob(req.body, req.user.username, tenantId);
    res.status(202).json({ success: true, data: job, message: 'Importação iniciada em segundo plano' });
  } catch (error) {
    if (/Selecione|Especialista|URL|docs|Cliente/i.test(error.message)) return res.status(400).json({ success: false, error: error.message });
    next(error);
  }
});

router.get('/crawl/jobs/:id', async (req, res, next) => {
  try {
    const job = await prisma.knowledgeImportJob.findUnique({ where: { id: req.params.id }, include: { tenant: { select: { id: true, name: true } } } });
    if (!job) return res.status(404).json({ success: false, error: 'Importação não encontrada' });
    res.json({ success: true, data: { ...job, errors: job.errors ? JSON.parse(job.errors) : [] } });
  } catch (error) { next(error); }
});

router.get('/', async (req, res, next) => {
  try {
    const documents = await prisma.knowledgeDocument.findMany({
      orderBy: { updatedAt: 'desc' },
      select: { id: true, tenantId: true, tenant: { select: { id: true, name: true } }, title: true, filename: true, sourceType: true, sourceUrl: true, collectionRootUrl: true, agentScope: true, mikrotikRole: true, routerOsMajor: true, tags: true, status: true, chunkCount: true, uploadedBy: true, createdAt: true, updatedAt: true },
    });
    res.json({ success: true, data: documents, scopes: KNOWLEDGE_SCOPES });
  } catch (error) { next(error); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const document = await prisma.knowledgeDocument.findUnique({ where: { id: req.params.id }, include: { tenant: { select: { id: true, name: true } } } });
    if (!document) return res.status(404).json({ success: false, error: 'Documento não encontrado' });
    res.json({ success: true, data: document });
  } catch (error) { next(error); }
});

router.post('/', async (req, res, next) => {
  try {
    const tenantId = await knowledgeTenantId(req.body.tenantId);
    const document = await createKnowledgeDocument(req.body, req.user.username, tenantId);
    res.status(201).json({ success: true, data: document, message: 'Documento indexado com sucesso' });
  } catch (error) {
    if (/arquivo|PDF|link|URL|HTTPS|página|texto|fonte|especialista|Markdown|MB|vazio|inválid|rede privada|HTTP|redirecionamento|OCR|Cliente/i.test(error.message)) return res.status(400).json({ success: false, error: error.message });
    next(error);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const tenantId = await knowledgeTenantId(req.body.tenantId);
    const document = await updateKnowledgeDocument(req.params.id, req.body, tenantId);
    res.json({ success: true, data: document, message: 'Documento atualizado e reindexado' });
  } catch (error) {
    if (error.message === 'Documento não encontrado') return res.status(404).json({ success: false, error: error.message });
    if (/arquivo|PDF|link|URL|HTTPS|página|texto|fonte|especialista|Markdown|MB|vazio|inválid|rede privada|HTTP|redirecionamento|OCR|Cliente/i.test(error.message)) return res.status(400).json({ success: false, error: error.message });
    next(error);
  }
});

router.patch('/:id/status', async (req, res, next) => {
  try {
    const status = req.body.status === 'disabled' ? 'disabled' : 'active';
    const document = await prisma.knowledgeDocument.update({ where: { id: req.params.id }, data: { status } });
    res.json({ success: true, data: document });
  } catch (error) { next(error); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await prisma.knowledgeDocument.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Documento removido da base de conhecimento' });
  } catch (error) { next(error); }
});

router.post('/test/search', async (req, res, next) => {
  try {
    const agentScope = KNOWLEDGE_SCOPES.includes(req.body.agentScope) ? req.body.agentScope : 'support';
    const tenantId = req.body.tenantId === 'all' ? undefined : await knowledgeTenantId(req.body.tenantId);
    const results = await searchKnowledge(String(req.body.query || ''), agentScope, 8, false, tenantId);
    res.json({ success: true, data: results.map(item => ({ id: item.id, heading: item.heading, content: item.content, score: item.score, document: item.document })) });
  } catch (error) { next(error); }
});

router.post('/bulk/classify', async (req,res,next) => {
  try {
    const ids=[...new Set((Array.isArray(req.body.ids)?req.body.ids:[]).map(String))].slice(0,1000);
    if(!ids.length)return res.status(400).json({success:false,error:'Selecione ao menos um documento'});
    const mikrotikRole=['router','switch'].includes(req.body.mikrotikRole)?req.body.mikrotikRole:null;
    const routerOsMajor=['6','7'].includes(String(req.body.routerOsMajor||''))?String(req.body.routerOsMajor):null;
    const result=await prisma.knowledgeDocument.updateMany({where:{id:{in:ids},agentScope:'mikrotik'},data:{mikrotikRole,routerOsMajor}});
    res.json({success:true,data:{updated:result.count},message:`${result.count} documento(s) MikroTik classificado(s)`});
  }catch(error){next(error);}
});

export default router;
