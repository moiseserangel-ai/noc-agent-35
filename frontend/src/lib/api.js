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

  if (res.status === 401 && token) {
    localStorage.removeItem('noc_token');
    window.location.reload();
    throw new Error('Unauthorized');
  }

  if (!res.ok) throw new Error(data.error || (res.status === 403 ? 'Sem permissão' : 'Request failed'));
  return data;
}

export const api = {
  // Auth
  login: (username, password, otp) => request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password, otp }) }),
  verify: () => request('/auth/verify'),
  refreshSession: () => request('/auth/refresh', { method: 'POST' }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  changePassword: (currentPassword, newPassword) => request('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }),
  setupTwoFactor: password => request('/auth/2fa/setup', { method: 'POST', body: JSON.stringify({ password }) }),
  enableTwoFactor: code => request('/auth/2fa/enable', { method: 'POST', body: JSON.stringify({ code }) }),
  disableTwoFactor: (password, code) => request('/auth/2fa/disable', { method: 'POST', body: JSON.stringify({ password, code }) }),
  getSessions: () => request('/auth/sessions'),
  revokeSession: id => request(`/auth/sessions/${id}`, { method: 'DELETE' }),
  getUsers: () => request('/users'),
  createUser: (data) => request('/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUser: (id, data) => request(`/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteUser: (id) => request(`/users/${id}`, { method: 'DELETE' }),
  getAuditLogs: (params = {}) => { const qs = new URLSearchParams(params).toString(); return request(`/audit${qs ? `?${qs}` : ''}`); },
  getAuditOptions: () => request('/audit/options'),
  getIncidentReport: (params = {}) => { const qs = new URLSearchParams(params).toString(); return request(`/reports/incidents${qs ? `?${qs}` : ''}`); },
  getAiUsage: (params = {}) => { const qs = new URLSearchParams(params).toString(); return request(`/ai-usage${qs ? `?${qs}` : ''}`); },
  unblockAiProvider: provider => request(`/ai-usage/${provider}/unblock`, { method: 'POST' }),
  getBackups: () => request('/backups'),
  getBackupStatus: () => request('/backups/status'),
  createBackup: () => request('/backups', { method: 'POST' }),
  updateBackupConfig: (data) => request('/backups/config', { method: 'PUT', body: JSON.stringify(data) }),
  restoreBackup: (filename, password) => request(`/backups/${encodeURIComponent(filename)}/restore`, { method: 'POST', body: JSON.stringify({ password }) }),
  downloadBackup: async filename => {
    const res = await fetch(`${BASE}/backups/${encodeURIComponent(filename)}/download`, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!res.ok) { let data={}; try{data=await res.json();}catch{} throw new Error(data.error || 'Falha ao baixar backup'); }
    return res.blob();
  },

  // Devices
  getDevices: () => request('/devices'),
  getDeviceTypes: () => request('/devices/catalog/types'),
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
  testTelegram: (token, chatId) => request('/settings/test-telegram', { method: 'POST', body: JSON.stringify({ token, chatId }) }),
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
