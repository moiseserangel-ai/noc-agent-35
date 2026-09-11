import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const schema = fs.readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
const service = fs.readFileSync(new URL('../src/services/knowledge.service.js', import.meta.url), 'utf8');
const routes = fs.readFileSync(new URL('../src/routes/knowledge.routes.js', import.meta.url), 'utf8');
const agent = fs.readFileSync(new URL('../src/agents/base-agent.js', import.meta.url), 'utf8');

test('knowledge documents and imports belong to an optional tenant', () => {
  assert.match(schema, /model KnowledgeDocument \{[\s\S]*?tenantId\s+String\?/);
  assert.match(schema, /model KnowledgeImportJob \{[\s\S]*?tenantId\s+String\?/);
  assert.match(schema, /knowledgeDocuments KnowledgeDocument\[\]/);
});

test('tenant search sees shared documents and its own documents only', () => {
  assert.match(service, /OR: tenantId \? \[\{ tenantId: null \}, \{ tenantId \}\] : \[\{ tenantId: null \}\]/);
  assert.doesNotMatch(service, /in: \[null, tenantId\]/);
  assert.match(service, /knowledgeContext\(query, agentName, tenantId = undefined\)/);
  assert.match(agent, /knowledgeContext\(knowledgeQuery, this\.name, tenantId\)/);
});

test('knowledge routes validate tenant ownership metadata', () => {
  assert.match(routes, /async function knowledgeTenantId/);
  assert.match(routes, /createKnowledgeDocument\(req\.body, req\.user\.username, tenantId\)/);
  assert.match(routes, /searchKnowledge\(String\(req\.body\.query \|\| ''\), agentScope, 8, false, tenantId\)/);
});
