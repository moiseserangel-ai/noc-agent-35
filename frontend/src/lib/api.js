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
  getBranding: () => request('/branding'),
  getPublicStatus: slug => request(`/public/status${slug?`/${encodeURIComponent(slug)}`:''}`),
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
  getTenants: () => request('/tenants'),
  createTenant: data => request('/tenants',{method:'POST',body:JSON.stringify(data)}),
  updateTenant: (id,data) => request(`/tenants/${id}`,{method:'PUT',body:JSON.stringify(data)}),
  createTenantSite: (id,data) => request(`/tenants/${id}/sites`,{method:'POST',body:JSON.stringify(data)}),
  deleteTenantSite: id => request(`/tenants/sites/${id}`,{method:'DELETE'}),
  getCmdbAssets: (params={}) => request(`/cmdb?${new URLSearchParams(params)}`),
  getCmdbSummary: (params={}) => request(`/cmdb/summary?${new URLSearchParams(params)}`),
  getCmdbAsset: id => request(`/cmdb/${id}`),
  createCmdbAsset: data => request('/cmdb',{method:'POST',body:JSON.stringify(data)}),
  updateCmdbAsset: (id,data) => request(`/cmdb/${id}`,{method:'PUT',body:JSON.stringify(data)}),
  deleteCmdbAsset: id => request(`/cmdb/${id}`,{method:'DELETE'}),
  syncCmdbDevices: () => request('/cmdb/sync-devices',{method:'POST'}),
  collectCmdbInventory: id => request(`/cmdb/${id}/inventory/collect`,{method:'POST'}),
  collectAllCmdbInventory: () => request('/cmdb/inventory/collect-all',{method:'POST'}),
  getCmdbInventory: (id,limit=50) => request(`/cmdb/${id}/inventory?limit=${limit}`),
  saveCmdbInventoryPolicy: (id,data) => request(`/cmdb/${id}/inventory/policy`,{method:'PUT',body:JSON.stringify(data)}),
  getAuditLogs: (params = {}) => { const qs = new URLSearchParams(params).toString(); return request(`/audit${qs ? `?${qs}` : ''}`); },
  getAuditOptions: () => request('/audit/options'),
  getIncidentReport: (params = {}) => { const qs = new URLSearchParams(params).toString(); return request(`/reports/incidents${qs ? `?${qs}` : ''}`); },
  getMonthlyReports: (params = {}) => { const qs = new URLSearchParams(params).toString(); return request(`/reports/monthly${qs ? `?${qs}` : ''}`); },
  saveMonthlyReportConfig: (tenantId, data) => request(`/reports/monthly/tenants/${tenantId}`, { method:'PUT', body:JSON.stringify(data) }),
  runMonthlyReport: tenantId => request(`/reports/monthly/tenants/${tenantId}/run`, { method:'POST' }),
  downloadMonthlyReport: async id => {
    const res=await fetch(`${BASE}/reports/monthly/${encodeURIComponent(id)}/pdf`,{headers:{Authorization:`Bearer ${getToken()}`}});
    if(!res.ok){let data={};try{data=await res.json();}catch{}throw new Error(data.error||'Falha ao baixar relatório mensal');}
    return {blob:await res.blob(),filename:res.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1]||'relatorio-mensal.pdf'};
  },
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
  getDeviceBackups: () => request('/device-backups'),
  getDeviceBackupSnapshots: (deviceId, limit = 100) => request(`/device-backups/snapshots?deviceId=${encodeURIComponent(deviceId)}&limit=${limit}`),
  saveDeviceBackupPolicy: (deviceId, data) => request(`/device-backups/policies/${deviceId}`, { method: 'PUT', body: JSON.stringify(data) }),
  runDeviceBackup: deviceId => request(`/device-backups/run/${deviceId}`, { method: 'POST' }),
  compareDeviceBackups: (before, after) => request(`/device-backups/compare?before=${encodeURIComponent(before)}&after=${encodeURIComponent(after)}`),
  deleteDeviceBackup: id => request(`/device-backups/snapshots/${id}`, { method: 'DELETE' }),
  downloadDeviceBackup: async id => {
    const res = await fetch(`${BASE}/device-backups/snapshots/${encodeURIComponent(id)}/download`, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!res.ok) { let data={}; try{data=await res.json();}catch{} throw new Error(data.error || 'Falha ao baixar configuração'); }
    return { blob: await res.blob(), filename: res.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] || 'configuracao.txt' };
  },
  getCompliance: () => request('/compliance'),
  getComplianceProfiles: deviceType => request(`/compliance/profiles${deviceType ? `?deviceType=${encodeURIComponent(deviceType)}` : ''}`),
  createComplianceProfile: data => request('/compliance/profiles', { method:'POST', body:JSON.stringify(data) }),
  updateComplianceProfile: (id, data) => request(`/compliance/profiles/${id}`, { method:'PUT', body:JSON.stringify(data) }),
  deleteComplianceProfile: id => request(`/compliance/profiles/${id}`, { method:'DELETE' }),
  getComplianceExceptions: deviceId => request(`/compliance/exceptions${deviceId ? `?deviceId=${encodeURIComponent(deviceId)}` : ''}`),
  createComplianceException: data => request('/compliance/exceptions', { method:'POST', body:JSON.stringify(data) }),
  revokeComplianceException: id => request(`/compliance/exceptions/${id}`, { method:'DELETE' }),
  getComplianceReport: params => request(`/compliance/reports?${new URLSearchParams(params)}`),
  getComplianceDashboard: () => request('/compliance/dashboard'),
  getComplianceGovernance: () => request('/compliance/governance'),
  saveComplianceEscalation: data => request('/compliance/governance/escalation', {method:'PUT',body:JSON.stringify(data)}),
  createComplianceScope: data => request('/compliance/scopes', {method:'POST',body:JSON.stringify(data)}),
  updateComplianceScope: (id,data) => request(`/compliance/scopes/${id}`, {method:'PUT',body:JSON.stringify(data)}),
  deleteComplianceScope: id => request(`/compliance/scopes/${id}`, {method:'DELETE'}),
  createComplianceRemediationTask: findingId => request(`/compliance/findings/${findingId}/remediation-task`, { method:'POST' }),
  downloadComplianceReport: async (format, params = {}) => {
    const res = await fetch(`${BASE}/compliance/reports/${format}?${new URLSearchParams(params)}`, { headers:{Authorization:`Bearer ${getToken()}`} });
    if (!res.ok) { let data={}; try{data=await res.json();}catch{} throw new Error(data.error||'Falha ao gerar relatório'); }
    return {blob:await res.blob(),filename:res.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1]||`compliance.${format}`};
  },
  saveCompliancePolicy: (deviceId, data) => request(`/compliance/policies/${deviceId}`, { method: 'PUT', body: JSON.stringify(data) }),
  runComplianceScan: deviceId => request(`/compliance/scan/${deviceId}`, { method: 'POST' }),
  getComplianceScans: (deviceId, limit = 100) => request(`/compliance/scans?${new URLSearchParams({ ...(deviceId && { deviceId }), limit })}`),
  getComplianceScan: id => request(`/compliance/scans/${id}`),
  deleteComplianceScan: id => request(`/compliance/scans/${id}`, { method: 'DELETE' }),
  getChanges: (params={}) => request(`/changes?${new URLSearchParams(params)}`),
  getChange: id => request(`/changes/${id}`),
  createChange: data => request('/changes',{method:'POST',body:JSON.stringify(data)}),
  updateChange: (id,data) => request(`/changes/${id}`,{method:'PUT',body:JSON.stringify(data)}),
  submitChange: id => request(`/changes/${id}/submit`,{method:'POST'}),
  approveChange: (id,approved,reason='') => request(`/changes/${id}/approval`,{method:'POST',body:JSON.stringify({approved,reason})}),
  startChange: id => request(`/changes/${id}/start`,{method:'POST'}),
  validateChange: id => request(`/changes/${id}/validate`,{method:'POST'}),
  rollbackChange: id => request(`/changes/${id}/rollback`,{method:'POST'}),
  cancelChange: (id,reason='') => request(`/changes/${id}/cancel`,{method:'POST',body:JSON.stringify({reason})}),
  getDiscovery: () => request('/discovery'),
  startDiscovery: data => request('/discovery',{method:'POST',body:JSON.stringify(data)}),
  cancelDiscovery: id => request(`/discovery/${id}/cancel`,{method:'POST'}),
  deleteDiscovery: id => request(`/discovery/${id}`,{method:'DELETE'}),
  importDiscoveredHost: (id,data) => request(`/discovery/hosts/${id}/import`,{method:'POST',body:JSON.stringify(data)}),
  ignoreDiscoveredHost: id => request(`/discovery/hosts/${id}/ignore`,{method:'POST'}),
  getCapacity: (days=30) => request(`/capacity?days=${encodeURIComponent(days)}`),
  collectCapacity: () => request('/capacity/collect',{method:'POST'}),
  downloadCapacityCsv: async(days=30)=>{
    const res=await fetch(`${BASE}/capacity/export.csv?days=${encodeURIComponent(days)}`,{headers:{Authorization:`Bearer ${getToken()}`}});
    if(!res.ok){let data={};try{data=await res.json();}catch{}throw new Error(data.error||'Falha ao exportar capacidade');}
    return {blob:await res.blob(),filename:res.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1]||'capacidade.csv'};
  },
  getTopology: () => request('/topology'),
  saveTopologyPositions: positions => request('/topology/positions',{method:'PUT',body:JSON.stringify({positions})}),
  createTopologyLink: data => request('/topology/links',{method:'POST',body:JSON.stringify(data)}),
  deleteTopologyLink: id => request(`/topology/links/${id}`,{method:'DELETE'}),
  getTopologyDiscovery: () => request('/topology/discovery'),
  startTopologyDiscovery: () => request('/topology/discovery',{method:'POST'}),
  approveTopologyNeighbor: id => request(`/topology/discovery/${id}/approve`,{method:'POST'}),
  ignoreTopologyNeighbor: id => request(`/topology/discovery/${id}/ignore`,{method:'POST'}),
  getRunbooks: (params={}) => request(`/runbooks?${new URLSearchParams(params)}`),
  getRunbookTemplates: () => request('/runbooks/templates'),
  importRunbookTemplate: key => request(`/runbooks/templates/${encodeURIComponent(key)}/import`,{method:'POST'}),
  getRunbook: id => request(`/runbooks/${id}`),
  createRunbook: data => request('/runbooks',{method:'POST',body:JSON.stringify(data)}),
  updateRunbook: (id,data) => request(`/runbooks/${id}`,{method:'PUT',body:JSON.stringify(data)}),
  publishRunbook: id => request(`/runbooks/${id}/publish`,{method:'POST'}),
  requestRunbookApproval: id => request(`/runbooks/${id}/request-approval`,{method:'POST'}),
  reviewRunbook: (id,approved,reason='') => request(`/runbooks/${id}/approval`,{method:'POST',body:JSON.stringify({approved,reason})}),
  archiveRunbook: id => request(`/runbooks/${id}/archive`,{method:'POST'}),
  simulateRunbook: (id,data) => request(`/runbooks/${id}/simulate`,{method:'POST',body:JSON.stringify(data)}),
  executeRunbook: (id,data) => request(`/runbooks/${id}/execute`,{method:'POST',body:JSON.stringify({...data,confirmed:true})}),
  getRunbookExecutions: (params={}) => request(`/runbooks/executions?${new URLSearchParams(params)}`),
  rollbackRunbook: id => request(`/runbooks/executions/${id}/rollback`,{method:'POST',body:JSON.stringify({confirmed:true})}),
  getRunbookSchedules: () => request('/runbooks/schedules'),
  createRunbookSchedule: data => request('/runbooks/schedules',{method:'POST',body:JSON.stringify(data)}),
  setRunbookScheduleEnabled: (id,enabled) => request(`/runbooks/schedules/${id}`,{method:'PATCH',body:JSON.stringify({enabled})}),
  deleteRunbookSchedule: id => request(`/runbooks/schedules/${id}`,{method:'DELETE'}),
  getRunbookBatches: () => request('/runbooks/batches'),
  getRunbookBatch: id => request(`/runbooks/batches/${id}`),
  createRunbookBatch: data => request('/runbooks/batches',{method:'POST',body:JSON.stringify(data)}),
  simulateRunbookBatch: id => request(`/runbooks/batches/${id}/simulate`,{method:'POST'}),
  executeRunbookBatch: id => request(`/runbooks/batches/${id}/execute`,{method:'POST',body:JSON.stringify({confirmed:true})}),
  getRunbookMetrics: () => request('/runbooks/metrics'),
  getRunbookRevisions: id => request(`/runbooks/${id}/revisions`),
  compareRunbookVersions: (id,from,to) => request(`/runbooks/${id}/compare?from=${from}&to=${to}`),

  // Devices
  getDevices: () => request('/devices'),
  getDeviceTypes: () => request('/devices/catalog/types'),
  getDevice: (id) => request(`/devices/${id}`),
  getDeviceChanges: id => request(`/devices/${id}/changes`),
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
  approveTask: (id, approved) => request(`/tasks/${id}/approval`, { method:'POST', body:JSON.stringify({approved}) }),
  getTaskRunbooks: id => request(`/tasks/${id}/runbooks`),
  simulateTaskRunbook: (taskId,runbookId,variables) => request(`/tasks/${taskId}/runbooks/${runbookId}/simulate`,{method:'POST',body:JSON.stringify({variables})}),
  executeTaskRunbook: (taskId,runbookId,variables) => request(`/tasks/${taskId}/runbooks/${runbookId}/execute`,{method:'POST',body:JSON.stringify({variables,confirmed:true})}),

  // Settings
  getSettings: () => request('/settings'),
  updateSetting: (key, value) => request(`/settings/${key}`, { method: 'PUT', body: JSON.stringify({ value }) }),
  updateSettingsBulk: (settings) => request('/settings/bulk', { method: 'POST', body: JSON.stringify({ settings }) }),
  updateBranding: data => request('/settings/branding', { method: 'POST', body: JSON.stringify(data) }),
  testClaudeAPI: (apiKey, model) => request('/settings/test-claude', { method: 'POST', body: JSON.stringify({ apiKey, model }) }),
  testAIProvider: (provider, model) => request('/settings/test-ai', { method: 'POST', body: JSON.stringify({ provider, model }) }),
  getGeminiModels: (apiKey) => request('/settings/gemini-models', { method: 'POST', body: JSON.stringify({ apiKey }) }),
  getOpenAIModels: (apiKey) => request('/settings/openai-models', { method: 'POST', body: JSON.stringify({ apiKey }) }),
  getClaudeModels: (apiKey) => request('/settings/claude-models', { method: 'POST', body: JSON.stringify({ apiKey }) }),
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

  // Base de conhecimento
  getKnowledgeDocuments: () => request('/knowledge'),
  getKnowledgeDocument: id => request(`/knowledge/${id}`),
  createKnowledgeDocument: data => request('/knowledge', { method: 'POST', body: JSON.stringify(data) }),
  updateKnowledgeDocument: (id, data) => request(`/knowledge/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  setKnowledgeDocumentStatus: (id, status) => request(`/knowledge/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  deleteKnowledgeDocument: id => request(`/knowledge/${id}`, { method: 'DELETE' }),
  testKnowledgeSearch: (query, agentScope, tenantId = 'all') => request('/knowledge/test/search', { method: 'POST', body: JSON.stringify({ query, agentScope, tenantId }) }),
  discoverKnowledgePages: data => request('/knowledge/crawl/discover', { method: 'POST', body: JSON.stringify(data) }),
  importKnowledgePages: data => request('/knowledge/crawl/import', { method: 'POST', body: JSON.stringify(data) }),
  getKnowledgeImportJob: id => request(`/knowledge/crawl/jobs/${id}`),

  // Terminal CLI
  getCliDevices: () => request('/cli/devices'),
  getCliSessions: (all = false) => request(`/cli/sessions${all ? '?all=true' : ''}`),
  createCliSession: deviceId => request('/cli/sessions', { method: 'POST', body: JSON.stringify({ deviceId }) }),
  getCliCommands: id => request(`/cli/sessions/${id}/commands`),
  executeCliCommand: (id, data) => request(`/cli/sessions/${id}/commands`, { method: 'POST', body: JSON.stringify(data) }),
  closeCliSession: id => request(`/cli/sessions/${id}/close`, { method: 'POST' }),

  // Health
  getHealth: () => fetch(`${BASE}/health`).then(r => r.json()),
  getNotifications: (params={}) => request(`/notifications?${new URLSearchParams(params)}`),
  readNotification: id => request(`/notifications/${id}/read`,{method:'POST'}),
  readAllNotifications: () => request('/notifications/read-all',{method:'POST'}),
  getNotificationRules: () => request('/notifications/rules/list'),
  createNotificationRule: data => request('/notifications/rules',{method:'POST',body:JSON.stringify(data)}),
  updateNotificationRule: (id,data) => request(`/notifications/rules/${id}`,{method:'PUT',body:JSON.stringify(data)}),
  deleteNotificationRule: id => request(`/notifications/rules/${id}`,{method:'DELETE'}),
  getOnCall: () => request('/on-call'),
  createOnCallTeam: data => request('/on-call/teams',{method:'POST',body:JSON.stringify(data)}),
  updateOnCallTeam: (id,data) => request(`/on-call/teams/${id}`,{method:'PUT',body:JSON.stringify(data)}),
  deleteOnCallTeam: id => request(`/on-call/teams/${id}`,{method:'DELETE'}),
  saveOnCallMember: (teamId,data) => request(`/on-call/teams/${teamId}/members`,{method:'POST',body:JSON.stringify(data)}),
  deleteOnCallMember: id => request(`/on-call/members/${id}`,{method:'DELETE'}),
  createOnCallShift: (teamId,data) => request(`/on-call/teams/${teamId}/shifts`,{method:'POST',body:JSON.stringify(data)}),
  deleteOnCallShift: id => request(`/on-call/shifts/${id}`,{method:'DELETE'}),
  createOnCallOverride: (teamId,data) => request(`/on-call/teams/${teamId}/overrides`,{method:'POST',body:JSON.stringify(data)}),
  deleteOnCallOverride: id => request(`/on-call/overrides/${id}`,{method:'DELETE'}),
  getStatusPageAdmin: () => request('/status-page'),
  saveStatusPageConfig: data => request('/status-page/config',{method:'PUT',body:JSON.stringify(data)}),
  createStatusService: data => request('/status-page/services',{method:'POST',body:JSON.stringify(data)}),
  updateStatusService: (id,data) => request(`/status-page/services/${id}`,{method:'PUT',body:JSON.stringify(data)}),
  deleteStatusService: id => request(`/status-page/services/${id}`,{method:'DELETE'}),
  publishStatusIncident: data => request('/status-page/incidents',{method:'POST',body:JSON.stringify(data)}),
  updateStatusIncident: (id,data) => request(`/status-page/incidents/${id}/updates`,{method:'POST',body:JSON.stringify(data)}),
};
