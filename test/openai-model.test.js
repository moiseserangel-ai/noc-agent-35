import test from 'node:test';
import assert from 'node:assert/strict';
import { filterOpenAiModels } from '../src/services/openai-model.service.js';

test('seletor OpenAI mantém modelos de texto e remove modelos incompatíveis', () => {
  const result = filterOpenAiModels([
    { id:'gpt-5.6-sol',created:30,owned_by:'openai' },
    { id:'o4-mini',created:20,owned_by:'openai' },
    { id:'text-embedding-3-large',created:40,owned_by:'openai' },
    { id:'gpt-realtime',created:50,owned_by:'openai' },
    { id:'whisper-1',created:10,owned_by:'openai' },
  ]);
  assert.deepEqual(result.map(model=>model.id), ['gpt-5.6-sol','o4-mini']);
});
