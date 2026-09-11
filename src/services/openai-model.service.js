const TEXT_MODEL_PREFIX = /^(?:gpt-|chatgpt-|o[134](?:-|$)|ft:|codex-|gpt-oss)/i;
const NON_AGENT_MODEL = /(?:embedding|moderation|whisper|tts|realtime|audio|transcri|image|dall-e|sora|search|computer-use)/i;

export function filterOpenAiModels(models = []) {
  return models
    .filter(model => model?.id && TEXT_MODEL_PREFIX.test(model.id) && !NON_AGENT_MODEL.test(model.id))
    .map(model => ({ id: model.id, name: model.id, owner: model.owned_by || null, created: model.created || null }))
    .sort((a, b) => (b.created || 0) - (a.created || 0) || a.id.localeCompare(b.id));
}

export async function listOpenAiModels(apiKey) {
  const response = await fetch('https://api.openai.com/v1/models', { headers: { authorization: `Bearer ${apiKey}` } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error?.message || `OpenAI HTTP ${response.status}`), { statusCode: response.status });
  return filterOpenAiModels(data.data || []);
}
