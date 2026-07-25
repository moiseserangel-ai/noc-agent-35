import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkMarkdown, fetchKnowledgeUrl, validateDocumentInput } from '../src/services/knowledge.service.js';

test('divide Markdown preservando os títulos das seções', () => {
  const chunks = chunkMarkdown('# BGP\nConfigure o peer e valide o estado.\n\n## Rollback\nRemova somente o peer criado.');
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].heading, 'BGP');
  assert.match(chunks[0].content, /valide o estado/);
  assert.equal(chunks[1].heading, 'Rollback');
});

test('aceita somente Markdown válido e escopo conhecido', () => {
  const valid = validateDocumentInput({ filename: 'ne8000.md', title: 'Huawei NE8000', content: '# BGP\nProcedimento', agentScope: 'huawei_vrp' });
  assert.equal(valid.agentScope, 'huawei_vrp');
  assert.throws(() => validateDocumentInput({ filename: 'manual.pdf', title: 'Manual', content: 'x', agentScope: 'global' }), /arquivo .md válido/);
  assert.throws(() => validateDocumentInput({ filename: 'manual.md', title: 'Manual', content: 'x', agentScope: 'cisco' }), /Especialista inválido/);
});

test('aceita TXT e PDF processado nos limites permitidos', () => {
  assert.equal(validateDocumentInput({ filename: 'rotas.txt', sourceType: 'text', title: 'Rotas', content: 'Procedimento de rotas', agentScope: 'linux' }).sourceType, 'text');
  assert.equal(validateDocumentInput({ filename: 'ne8000.pdf', sourceType: 'pdf', title: 'NE8000', content: 'Texto previamente extraído do manual', agentScope: 'huawei_vrp' }).sourceType, 'pdf');
});

test('bloqueia links HTTP e endereços privados antes do download', async () => {
  await assert.rejects(fetchKnowledgeUrl('http://example.com/manual'), /Somente links HTTPS/);
  await assert.rejects(fetchKnowledgeUrl('https://127.0.0.1/manual'), /rede privada/);
});
