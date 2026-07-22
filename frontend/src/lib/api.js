const BASE = '/api';

function getToken() {
  return localStorage.getItem('noc_token');
}

async function request(path, options = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  const data = await res.json();

  if (res.status === 401) {
    localStorage.removeItem('noc_token');
    window.location.reload();
    throw new Error('Unauthorized');
  }

  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export const api = {
  // Auth
  login: (password) => request('/auth/login', { method: 'POST', body: JSON.stringify({ password }) }),
  verify: () => request('/auth/verify'),
  refreshSession: () => request('/auth/refresh', { method: 'POST' }),

  // Devices
  getDevices: () => request('/devices'),
  getDevice: (id) => request(`/devices/${id}`),
  createDevice: (data) => request('/devices', { method: 'POST', body: JSON.stringify(data) }),
  updateDevice: (id, data) => request(`/devices/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteDevice: (id) => request(`/devices/${id}`, { method: 'DELETE' }),
  testDevice: (id) => request(`/devices/${id}/test`, { method: 'POST' }),

  // Tasks
  getTasks: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/tasks${qs ? `?${qs}` : ''}`);
  },
  getTaskStats: () => request('/tasks/stats'),
  getTask: (id) => request(`/tasks/${id}`),
  reprocessTask: (id, deviceId) => request(`/tasks/${id}/reprocess`, { method: 'POST', body: JSON.stringify({ deviceId }) }),
  completeTask: (id, note) => request(`/tasks/${id}/complete`, { method: 'POST', body: JSON.stringify({ note }) }),
  updateTaskWorkflow: (id, data) => request(`/tasks/${id}/workflow`, { method: 'POST', body: JSON.stringify(data) }),

  // Settings
  getSettings: () => request('/settings'),
  updateSetting: (key, value) => request(`/settings/${key}`, { method: 'PUT', body: JSON.stringify({ value }) }),
  updateSettingsBulk: (settings) => request('/settings/bulk', { method: 'POST', body: JSON.stringify({ settings }) }),
  testClaudeAPI: (apiKey, model) => request('/settings/test-claude', { method: 'POST', body: JSON.stringify({ apiKey, model }) }),
  testAIProvider: (provider, model) => request('/settings/test-ai', { method: 'POST', body: JSON.stringify({ provider, model }) }),
  getGeminiModels: (apiKey) => request('/settings/gemini-models', { method: 'POST', body: JSON.stringify({ apiKey }) }),
  testEvolutionAPI: (data) => request('/settings/test-evolution', { method: 'POST', body: JSON.stringify(data) }),
  getVpn: () => request('/vpn'),
  saveVpn: (data) => request('/vpn', { method: 'PUT', body: JSON.stringify(data) }),
  connectVpn: () => request('/vpn/connect', { method: 'POST' }),
  disconnectVpn: () => request('/vpn/disconnect', { method: 'POST' }),

  // Chat
  getChatSessions: () => request('/chat/sessions'),
  createChatSession: (title) => request('/chat/sessions', { method: 'POST', body: JSON.stringify({ title }) }),
  getChatMessages: (sessionId) => request(`/chat/sessions/${sessionId}/messages`),
  deleteChatSession: (id) => request(`/chat/sessions/${id}`, { method: 'DELETE' }),

  // Health
  getHealth: () => fetch(`${BASE}/health`).then(r => r.json()),
};
