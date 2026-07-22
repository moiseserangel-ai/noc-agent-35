import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyAiError, normalizeUsage } from '../src/services/ai-usage.service.js';

test('normaliza tokens dos três formatos de usage', () => {
  assert.deepEqual(normalizeUsage('claude', { input_tokens: 100, output_tokens: 20 }), {
    inputTokens: 100, outputTokens: 20, totalTokens: 120, estimatedCost: 0.0006,
  });
  assert.equal(normalizeUsage('openai', { input_tokens: 40, output_tokens: 10, total_tokens: 50 }).totalTokens, 50);
  assert.equal(normalizeUsage('gemini', { promptTokenCount: 12, candidatesTokenCount: 3, totalTokenCount: 15 }).totalTokens, 15);
});

test('distingue cota esgotada de rate limit temporário', () => {
  assert.equal(classifyAiError(Object.assign(new Error('You exceeded your current quota and billing'), { status: 429 })).kind, 'quota');
  assert.equal(classifyAiError(Object.assign(new Error('Too many requests'), { status: 429, retryAfter: '12' })).kind, 'rate_limit');
  assert.equal(classifyAiError(Object.assign(new Error('Unauthorized'), { status: 401 })).kind, 'auth');
});
