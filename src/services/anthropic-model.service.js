export function normalizeAnthropicModels(models = []) {
  return models
    .filter(model => typeof model?.id === 'string' && model.id.startsWith('claude-'))
    .map(model => ({
      id: model.id,
      name: model.display_name || model.id,
      createdAt: model.created_at || null,
    }))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || a.name.localeCompare(b.name));
}

export async function listAnthropicModels(apiKey) {
  const response = await fetch('https://api.anthropic.com/v1/models?limit=1000', {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(data.error?.message || `Anthropic HTTP ${response.status}`), { statusCode: response.status });
  }
  return normalizeAnthropicModels(data.data || []);
}
