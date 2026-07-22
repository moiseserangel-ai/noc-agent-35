import Anthropic from '@anthropic-ai/sdk';

const ensureOk = async response => {
  if (response.ok) return response.json();
  const body = await response.text();
  throw new Error(`HTTP ${response.status}: ${body.slice(0, 500)}`);
};

const normalizeHistory = history => (Array.isArray(history) ? history : [])
  .filter(item => ['user', 'assistant'].includes(item.role) && typeof item.content === 'string' && item.content.trim())
  .reduce((messages, item) => {
    const previous = messages.at(-1);
    if (previous?.role === item.role) previous.content += `\n\n${item.content}`;
    else messages.push({ role: item.role, content: item.content });
    return messages;
  }, []);

export async function runAnthropic({ apiKey, model, systemPrompt, tools, message, history, executeTool, onEvent }) {
  const client = new Anthropic({ apiKey });
  const messages = [...normalizeHistory(history), { role: 'user', content: message }];
  const used = [];
  let response;
  do {
    response = await client.messages.create({ model, max_tokens: 4096, system: systemPrompt, tools: tools.length ? tools : undefined, messages });
    const calls = response.content.filter(item => item.type === 'tool_use');
    if (!calls.length) break;
    const results = [];
    for (const call of calls) {
      onEvent?.({ type: 'tool_start', tool: call.name, input: call.input });
      const output = await executeTool(call.name, call.input);
      used.push({ tool: call.name, input: call.input, output });
      onEvent?.({ type: 'tool_result', tool: call.name, output });
      results.push({ type: 'tool_result', tool_use_id: call.id, content: output });
    }
    messages.push({ role: 'assistant', content: response.content }, { role: 'user', content: results });
  } while (true);
  return { text: response.content.filter(i => i.type === 'text').map(i => i.text).join('\n'), toolsUsed: used, usage: response.usage };
}

export async function runOpenAI({ apiKey, model, systemPrompt, tools, message, history, executeTool, onEvent }) {
  const apiTools = tools.map(t => ({ type: 'function', name: t.name, description: t.description, parameters: t.input_schema }));
  const used = [];
  let input = [...normalizeHistory(history), { role: 'user', content: message }];
  let previousResponseId;
  let response;
  do {
    response = await ensureOk(await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, instructions: systemPrompt, input, tools: apiTools.length ? apiTools : undefined, previous_response_id: previousResponseId, store: true }),
    }));
    const calls = (response.output || []).filter(item => item.type === 'function_call');
    if (!calls.length) break;
    input = [];
    for (const call of calls) {
      let args = {}; try { args = JSON.parse(call.arguments || '{}'); } catch { throw new Error(`Argumentos inválidos da tool ${call.name}`); }
      onEvent?.({ type: 'tool_start', tool: call.name, input: args });
      const output = await executeTool(call.name, args);
      used.push({ tool: call.name, input: args, output });
      onEvent?.({ type: 'tool_result', tool: call.name, output });
      input.push({ type: 'function_call_output', call_id: call.call_id, output });
    }
    previousResponseId = response.id;
  } while (true);
  const text = response.output_text || (response.output || []).flatMap(i => i.content || []).filter(i => i.type === 'output_text').map(i => i.text).join('\n');
  return { text, toolsUsed: used, usage: response.usage };
}

export async function runGemini({ apiKey, model, systemPrompt, tools, message, history, executeTool, onEvent }) {
  const contents = [...normalizeHistory(history).map(item => ({ role: item.role === 'assistant' ? 'model' : 'user', parts: [{ text: item.content }] })), { role: 'user', parts: [{ text: message }] }];
  const apiTools = tools.length ? [{ functionDeclarations: tools.map(t => ({ name: t.name, description: t.description, parameters: t.input_schema })) }] : undefined;
  const used = [];
  let data;
  do {
    data = await ensureOk(await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: systemPrompt }] }, contents, tools: apiTools }),
    }));
    const content = data.candidates?.[0]?.content;
    if (!content) throw new Error(data.promptFeedback?.blockReason || 'Gemini não retornou conteúdo');
    const calls = content.parts?.filter(part => part.functionCall) || [];
    if (!calls.length) break;
    contents.push(content);
    const responseParts = [];
    for (const part of calls) {
      const call = part.functionCall;
      const args = call.args || {};
      onEvent?.({ type: 'tool_start', tool: call.name, input: args });
      const output = await executeTool(call.name, args);
      used.push({ tool: call.name, input: args, output });
      onEvent?.({ type: 'tool_result', tool: call.name, output });
      responseParts.push({ functionResponse: { name: call.name, response: { result: output } } });
    }
    contents.push({ role: 'user', parts: responseParts });
  } while (true);
  return { text: (data.candidates?.[0]?.content?.parts || []).filter(p => p.text).map(p => p.text).join('\n'), toolsUsed: used, usage: data.usageMetadata };
}

export const providerRunners = { claude: runAnthropic, openai: runOpenAI, gemini: runGemini };
