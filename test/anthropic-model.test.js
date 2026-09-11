import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAnthropicModels } from '../src/services/anthropic-model.service.js';

test('normaliza e ordena os modelos Claude retornados pela Anthropic', () => {
  const result = normalizeAnthropicModels([
    { id: 'not-claude', display_name: 'Incompatível', created_at: '2026-01-01T00:00:00Z' },
    { id: 'claude-sonnet-old', display_name: 'Claude Sonnet antigo', created_at: '2025-01-01T00:00:00Z' },
    { id: 'claude-sonnet-new', display_name: 'Claude Sonnet novo', created_at: '2026-01-01T00:00:00Z' },
  ]);
  assert.deepEqual(result.map(model => model.id), ['claude-sonnet-new', 'claude-sonnet-old']);
  assert.equal(result[0].name, 'Claude Sonnet novo');
});
