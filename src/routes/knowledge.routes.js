import { Router } from 'express';
import prisma from '../database/client.js';
import { createKnowledgeDocument, KNOWLEDGE_SCOPES, searchKnowledge, updateKnowledgeDocument } from '../services/knowledge.service.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const documents = await prisma.knowledgeDocument.findMany({
      orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, filename: true, sourceType: true, sourceUrl: true, agentScope: true, tags: true, status: true, chunkCount: true, uploadedBy: true, createdAt: true, updatedAt: true },
    });
    res.json({ success: true, data: documents, scopes: KNOWLEDGE_SCOPES });
  } catch (error) { next(error); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const document = await prisma.knowledgeDocument.findUnique({ where: { id: req.params.id } });
    if (!document) return res.status(404).json({ success: false, error: 'Documento não encontrado' });
    res.json({ success: true, data: document });
  } catch (error) { next(error); }
});

router.post('/', async (req, res, next) => {
  try {
    const document = await createKnowledgeDocument(req.body, req.user.username);
    res.status(201).json({ success: true, data: document, message: 'Documento indexado com sucesso' });
  } catch (error) {
    if (/arquivo|PDF|link|URL|HTTPS|página|texto|fonte|especialista|Markdown|MB|vazio|inválid|rede privada|HTTP|redirecionamento|OCR/i.test(error.message)) return res.status(400).json({ success: false, error: error.message });
    next(error);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const document = await updateKnowledgeDocument(req.params.id, req.body);
    res.json({ success: true, data: document, message: 'Documento atualizado e reindexado' });
  } catch (error) {
    if (error.message === 'Documento não encontrado') return res.status(404).json({ success: false, error: error.message });
    if (/arquivo|PDF|link|URL|HTTPS|página|texto|fonte|especialista|Markdown|MB|vazio|inválid|rede privada|HTTP|redirecionamento|OCR/i.test(error.message)) return res.status(400).json({ success: false, error: error.message });
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
    const results = await searchKnowledge(String(req.body.query || ''), agentScope, 8, false);
    res.json({ success: true, data: results.map(item => ({ id: item.id, heading: item.heading, content: item.content, score: item.score, document: item.document })) });
  } catch (error) { next(error); }
});

export default router;
