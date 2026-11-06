// All requests go through Kong proxy at /api/*
// Vite dev server proxies /api → http://phoenix:8000

const MUTATING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE']

// AUTH-305 — double-submit CSRF: the server set a non-httpOnly ioa_csrf
// cookie at login specifically so this can read it and echo it back.
function readCookie(name) {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
  return match ? decodeURIComponent(match[1]) : null
}

async function request(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase()
  const headers = { 'Content-Type': 'application/json', ...options.headers }
  if (MUTATING_METHODS.includes(method)) {
    const csrfToken = readCookie('ioa_csrf')
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken
  }

  const res = await fetch(`/api${path}`, {
    credentials: 'include', // AUTH-304 — the httpOnly session cookie only rides along with this
    headers,
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  // AUTH-303 — an expired/invalid session surfaces as 401 from any call
  // made once inside the app; bounce to /login rather than rendering a
  // broken authenticated page. Only /auth/me (AuthGuard's own session-restore
  // check) and /auth/login (the Login form's own failed-attempt handling)
  // are excluded — a 401 there is a normal, expected outcome they already
  // handle directly. Everything else under /auth/ (user management, API
  // keys, self-service password change) is a real authenticated action:
  // a 401 there means the session died mid-use, same as anywhere else in
  // the app, and previously fell through to dumping the raw server error
  // ("Not authenticated") into whatever form triggered it instead of
  // bouncing to /login like every other page correctly does.
  const SESSION_CHECK_PATHS = ['/auth/me', '/auth/login']
  if (res.status === 401 && !SESSION_CHECK_PATHS.includes(path)) {
    window.location.href = '/login'
    throw new Error('Not authenticated')
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    // status/body ride along for callers that need more than the message
    // (e.g. the policy bundle import preview shows the server's error list).
    throw Object.assign(new Error(err.error ?? res.statusText), { status: res.status, body: err })
  }
  return res.status === 204 ? null : res.json()
}

export const api = {
  get:    (path)         => request(path),
  post:   (path, body)   => request(path, { method: 'POST',   body }),
  put:    (path, body)   => request(path, { method: 'PUT',    body }),
  patch:  (path, body)   => request(path, { method: 'PATCH',  body }),
  delete: (path)         => request(path, { method: 'DELETE' }),
}

// Triggers a browser save-as for a JSON payload already fetched via api.get
// (the export endpoints return plain JSON over the same authenticated
// `request()` path — no separate blob-fetch plumbing needed). Used by the
// workflow and audit backup buttons.
export function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// --- Auth ---
export const auth = {
  login:  (username, password) => request('/auth/login', { method: 'POST', body: { username, password } }),
  logout: ()                    => request('/auth/logout', { method: 'POST' }),
  me:     ()                    => request('/auth/me'),
  changePassword: (current_password, new_password) =>
    api.patch('/auth/me/password', { current_password, new_password }),
}

// --- User management (EP-308-S7) ---
export const users = {
  list:       ()                        => api.get('/auth/users'),
  get:        (id)                      => api.get(`/auth/users/${id}`),
  create:     (body)                    => api.post('/auth/users', body),
  setRoles:   (id, roles)              => api.patch(`/auth/users/${id}/roles`, { roles }),
  disable:    (id)                      => api.delete(`/auth/users/${id}`),
  enable:     (id)                      => api.patch(`/auth/users/${id}/enable`),
  resetPassword: (id, password)         => api.patch(`/auth/users/${id}/password`, { password }),
}

// --- API keys (EP-306-S12) — issued for machine callers, e.g. Zapier's
// enforcement connection (see admin/Integrations.jsx). The raw key is only
// ever present in create()'s response, once.
export const apiKeys = {
  list:   ()     => api.get('/auth/api-keys'),
  create: (body) => api.post('/auth/api-keys', body),
  remove: (id)   => api.delete(`/auth/api-keys/${id}`),
}

// --- Governance ---
export const governance = {
  listPolicies:   (status)     => api.get(`/governance/policies${status ? `?status=${status}` : ''}`),
  getPolicy:      (id)         => api.get(`/governance/policies/${id}`),
  createPolicy:   (body)       => api.post('/governance/policies', body),
  updatePolicy:   (id, body)   => api.put(`/governance/policies/${id}`, body),
  setStatus:      (id, status) => api.patch(`/governance/policies/${id}/status`, { status }),
  // EP-201-S2
  setEnforcementMode: (id, mode) => api.patch(`/governance/policies/${id}/enforcement-mode`, { enforcement_mode: mode }),
  deletePolicy:   (id)         => api.delete(`/governance/policies/${id}`),
  addRule:        (id, body)   => api.post(`/governance/policies/${id}/rules`, body),
  deleteRule:     (id, ruleId) => api.delete(`/governance/policies/${id}/rules/${ruleId}`),
  addBinding:     (id, body)   => api.post(`/governance/policies/${id}/bindings`, body),
  deleteBinding:  (id, bId)    => api.delete(`/governance/policies/${id}/bindings/${bId}`),
  // Policy bundles (policy-as-code)
  exportBundle:   ({ ids, status, skipLegacy } = {}) => {
    const q = new URLSearchParams()
    if (ids?.length) q.set('ids', ids.join(','))
    if (status)      q.set('status', status)
    if (skipLegacy)  q.set('skip_legacy', 'true')
    const qs = q.toString()
    return api.get(`/governance/policy-bundles/export${qs ? `?${qs}` : ''}`)
  },
  validateBundle: (bundle, onConflict) => api.post('/governance/policy-bundles/validate', { bundle, on_conflict: onConflict }),
  importBundle:   (bundle, onConflict) => api.post('/governance/policy-bundles/import',   { bundle, on_conflict: onConflict }),
  // Rule type catalog
  listRuleSchemas: ()           => api.get('/governance/rule-schemas'),
  getRuleSchema:   (type)       => api.get(`/governance/rule-schemas/${type}`),
  // Violations
  listViolations:  (params)     => api.get(`/governance/violations?${new URLSearchParams(params ?? {})}`),
  violationSummary: ()          => api.get('/governance/violations/summary'),
  evaluateWorkflow: (workflowId) => api.post('/governance/violations/evaluate', { workflow_id: workflowId }),
  evaluateMcpServer: (serverId) => api.post('/governance/violations/evaluate', { server_id: serverId }),
  resolveViolation: (id, status) => api.patch(`/governance/violations/${id}/status`, { status }),
  // EP-103-S6 — append-only status-transition timeline for one violation.
  violationHistory: (id)        => api.get(`/governance/violations/${id}/history`),
  // EP-105-S2 — dedicated lifecycle actions
  acknowledgeViolation: (id)    => api.patch(`/governance/violations/${id}/acknowledge`),
  markRemediating:      (id)    => api.patch(`/governance/violations/${id}/remediating`),
  resolveViolationWithReason: (id, resolution_reason) => api.patch(`/governance/violations/${id}/resolve`, { resolution_reason }),
  // EP-104 — waiver management
  requestWaiver:  (id, body)    => api.post(`/governance/violations/${id}/waivers`, body),
  listWaivers:    (params)      => api.get(`/governance/violations/waivers?${new URLSearchParams(params ?? {})}`),
  decideWaiver:   (id, decision) => api.patch(`/governance/violations/waivers/${id}/approve`, { decision }),
  // EP-103-S7 — platform-wide approval decision log, filterable by asset.
  approvalDecisions: (assetType, assetId) => api.get(`/governance/approval-decisions?asset_type=${assetType}&asset_id=${assetId}`),
  // Unified history: one server plus all its tools'/prompts' decisions in a
  // single call — they span different asset_ids (and usually asset_types).
  approvalDecisionsByIds: (assetIds) => api.get(`/governance/approval-decisions?asset_ids=${assetIds.join(',')}`),
  // EP-202 — Human Approval Gates
  listApprovalChains:   (params)  => api.get(`/governance/approval-chains?${new URLSearchParams(params ?? {})}`),
  createApprovalChain:  (body)    => api.post('/governance/approval-chains', body),
  setApprovalChainStatus: (id, status) => api.patch(`/governance/approval-chains/${id}/status`, { status }),
  listApprovalRequests: (params)  => api.get(`/governance/approval-chains/requests?${new URLSearchParams(params ?? {})}`),
  getApprovalRequest:   (id)      => api.get(`/governance/approval-chains/requests/${id}`),
  decideApprovalRequest: (id, body) => api.post(`/governance/approval-chains/requests/${id}/decisions`, body),
  // EP-201 — Policy Enforcement Control Center
  checkEnforcement:      (body)   => api.post('/governance/enforce', body),
  listEnforcementEvents: (params) => api.get(`/governance/enforce?${new URLSearchParams(params ?? {})}`),
  enforcementSummary:    ()       => api.get('/governance/enforce/summary'),
  // EP-203 — Kill Switch & Containment
  getContainment:  (assetType, assetId) => api.get(`/governance/assets/${assetType}/${assetId}/containment`),
  suspendAsset:    (assetType, assetId, reason) => api.post(`/governance/assets/${assetType}/${assetId}/suspend`, { reason }),
  quarantineAsset: (assetType, assetId, reason) => api.post(`/governance/assets/${assetType}/${assetId}/quarantine`, { reason }),
  restoreAsset:    (assetType, assetId, reason) => api.post(`/governance/assets/${assetType}/${assetId}/restore`, { reason }),
  rollbackAsset:   (assetType, assetId, reason) => api.post(`/governance/assets/${assetType}/${assetId}/rollback`, { reason }),
}

// --- AI Usage Budgets (E7) ---
export const budgets = {
  list:   (status)   => api.get(`/inference/budgets${status ? `?status=${status}` : ''}`),
  create: (body)     => api.post('/inference/budgets', body),
  update: (id, body) => api.put(`/inference/budgets/${id}`, body),
  archive: (id)      => api.patch(`/inference/budgets/${id}/archive`, {}), // archives server-side, not a hard delete; PATCH not DELETE — Kong's route here doesn't allow DELETE
}

// --- AI Inference ---
export const inference = {
  listModels:      (status) => api.get(`/inference/models${status ? `?status=${status}` : ''}`),
  registerModel:   (body)   => api.post('/inference/models', body),
  setModelStatus:  (id, s)  => api.patch(`/inference/models/${id}/status`, { status: s }),
  listRequests:    (params) => api.get(`/inference/inference?${new URLSearchParams(params ?? {})}`),
  submit:          (body)   => api.post('/inference/inference', body),
  getRequest:      (id)     => api.get(`/inference/inference/${id}`),
  listDecisions:   (params) => api.get(`/inference/inference/decisions?${new URLSearchParams(params)}`),
  recordDecision:  (id, body) => api.post(`/inference/inference/${id}/decisions`, body),
}

// --- Audit ---
export const audit = {
  recordEvent: (body)   => api.post('/audit/events', body),
  listEvents:  (params) => api.get(`/audit/events?${new URLSearchParams(params)}`),
  getEvent:    (id)     => api.get(`/audit/events/${id}`),
  exportBackup:(params) => api.get(`/audit/events/export?${new URLSearchParams(params ?? {})}`),
}

// --- Escalation ---
export const escalation = {
  listRules:       (params) => api.get(`/escalation/rules?${new URLSearchParams(params)}`),
  createRule:      (body)   => api.post('/escalation/rules', body),
  updateRule:      (id, b)  => api.put(`/escalation/rules/${id}`, b),
  deleteRule:      (id)     => api.delete(`/escalation/rules/${id}`),
  listIncidents:   (params) => api.get(`/escalation/incidents?${new URLSearchParams(params)}`),
  getIncident:     (id)     => api.get(`/escalation/incidents/${id}`),
  triggerIncident: (body)   => api.post('/escalation/incidents', body),
  transitionStatus:(id, s)  => api.patch(`/escalation/incidents/${id}/status`, { status: s }),
}

// --- Telemetry ---
export const telemetry = {
  ingest:   (body)   => api.post('/telemetry/metrics', body),
  query:    (params) => api.get(`/telemetry/metrics?${new URLSearchParams(params)}`),
  summary:  (params) => api.get(`/telemetry/metrics/summary?${new URLSearchParams(params ?? {})}`),
  // EP-102-S8 — the full chain of everything recorded under one
  // correlation_id, in chronological order.
  correlationChain: (id) => api.get(`/telemetry/metrics/correlation/${encodeURIComponent(id)}`),
}

// --- Platform Connections ---
export const platforms = {
  list:   ()         => api.get('/workflow-governance/platforms'),
  create: (body)     => api.post('/workflow-governance/platforms', body),
  update: (id, body) => api.put(`/workflow-governance/platforms/${id}`, body),
  remove: (id)       => api.delete(`/workflow-governance/platforms/${id}`),
  test:   (id)       => api.post(`/workflow-governance/platforms/${id}/test`, {}),
}

// --- Tag Registry ---
export const tags = {
  list:   ()         => api.get('/workflow-governance/tags'),
  create: (body)     => api.post('/workflow-governance/tags', body),
  update: (id, body) => api.put(`/workflow-governance/tags/${id}`, body),
  remove: (id)       => api.delete(`/workflow-governance/tags/${id}`),
}

// --- Workflow Governance ---
export const workflowGovernance = {
  listWorkflows:  (params) => api.get(`/workflow-governance/workflows?${new URLSearchParams(params ?? {})}`),
  getWorkflow:    (id)     => api.get(`/workflow-governance/workflows/${id}`),
  discover:       (connectionId) => api.post('/workflow-governance/workflows/discover', connectionId ? { connection_id: connectionId } : {}),
  clearAll:       ()       => api.delete('/workflow-governance/workflows'),
  exportBackup:   ()       => api.get('/workflow-governance/workflows/export'),
  restoreBackup:  (backup) => api.post('/workflow-governance/workflows/restore', backup),
  n8nWorkflows:   ()       => api.get('/workflow-governance/workflows/n8n'),
  makeWorkflows:   (connId)          => api.get(`/workflow-governance/workflows/make?connection_id=${connId}`),
  zapierWorkflows:  (connId)          => api.get(`/workflow-governance/workflows/zapier?connection_id=${connId}`),
  camundaWorkflows: (connId)          => api.get(`/workflow-governance/workflows/camunda?connection_id=${connId}`),
  paEnvironments:  (connId)          => api.get(`/workflow-governance/workflows/power-automate/environments?connection_id=${connId}`),
  paWorkflows:     (connId)          => api.get(`/workflow-governance/workflows/power-automate?connection_id=${connId}`),
  n8nProjects:    ()       => api.get('/workflow-governance/workflows/n8n').then(list =>
                               [...new Map(list.filter(w => w.project_id)
                                 .map(w => [w.project_id, { id: w.project_id, name: w.project_name }]))
                                 .values()]),
  importWorkflow: (body)   => api.post('/workflow-governance/workflows/import', body),
  scoreWorkflow:    (id)     => api.post(`/workflow-governance/workflows/${id}/score`, {}),
  applyPolicies:    (id)     => api.post(`/workflow-governance/workflows/${id}/policies/apply`, {}),
  analyzeWorkflow:  (id)     => api.post(`/workflow-governance/workflows/${id}/analyze`, {}),
  getAnalysis:      (jobId)  => api.get(`/workflow-governance/workflows/analysis/${jobId}`),
  listAnalyses:     (id)     => api.get(`/workflow-governance/workflows/${id}/analyses`),
  appliedPolicies:  (id)     => api.get(`/workflow-governance/workflows/${id}/applied-policies`),
  riskSummary:      ()       => api.get('/workflow-governance/risk/summary'),
  riskNodes:        ()       => api.get('/workflow-governance/risk/nodes'),
  riskPiiType:      (type)   => api.get(`/workflow-governance/risk/pii/${encodeURIComponent(type)}`),
  riskSecretType:   (type)   => api.get(`/workflow-governance/risk/secrets/${encodeURIComponent(type)}`),
  riskByDomain:     ()       => api.get('/workflow-governance/risk/by-domain'),
  riskHistory:      (id)     => api.get(`/workflow-governance/workflows/${id}/risk-history`),
  updateOwnership:  (id, body) => api.patch(`/workflow-governance/workflows/${id}/ownership`, body),
  // EP-101-S8 — claims a hardcoded-secret finding has been rotated; the
  // finding stays visible until the next scan proves it (fingerprint gone).
  confirmSecretRotation: (id, confirmedBy) => api.patch(`/workflow-governance/workflows/secret-exposure/${id}/confirm-rotation`, { confirmed_by: confirmedBy }),
}

// --- Automation Trust Index ---
export const trust = {
  summary:  ()       => api.get('/workflow-governance/trust/summary'),
  byDomain: ()       => api.get('/workflow-governance/trust/by-domain'),
}

// --- Assurance (recoverability evidence) ---
export const assurance = {
  list:         (workflowId) => api.get(`/workflow-governance/assurance/${workflowId}`),
  listPlatform: ()           => api.get('/workflow-governance/assurance/platform'),
  record:       (body)       => api.post('/workflow-governance/assurance', body),
}

export const controlTests = {
  list:     ()         => api.get('/governance/control-tests'),
  listRuns: (testId)   => api.get(`/governance/control-tests/${testId}/runs`),
}

// --- Data Lineage (EP-304) ---
export const lineage = {
  listChains:     (params)          => api.get(`/workflow-governance/lineage?${new URLSearchParams(params ?? {})}`),
  getChain:       (correlationId)   => api.get(`/workflow-governance/lineage/${encodeURIComponent(correlationId)}`),
  buildChain:     (correlationId)   => api.post('/workflow-governance/lineage/build', { correlation_id: correlationId }),
  listViolations: ()                => api.get('/workflow-governance/lineage/violations'),
}

// --- Anomaly Detection (EP-305) ---
export const anomaly = {
  summary:        ()              => api.get('/workflow-governance/anomaly/summary'),
  listAlerts:     (params)        => api.get(`/workflow-governance/anomaly/alerts?${new URLSearchParams(params ?? {})}`),
  patchAlert:     (id, body)      => api.patch(`/workflow-governance/anomaly/alerts/${id}`, body),
  listBaselines:  ()              => api.get('/workflow-governance/anomaly/baselines'),
  getBaseline:    (workflowId)    => api.get(`/workflow-governance/anomaly/baselines/${workflowId}`),
  computeBaseline:(workflowId)    => api.post(`/workflow-governance/anomaly/baselines/${workflowId}/compute`, {}),
  score:          (correlationId) => api.post('/workflow-governance/anomaly/score', { correlation_id: correlationId }),
}

// --- Attack Paths (EP-305) ---
export const attackPaths = {
  list:        ()             => api.get('/workflow-governance/attack-paths'),
  summary:     ()             => api.get('/workflow-governance/attack-paths/summary'),
  get:         (serverId)     => api.get(`/workflow-governance/attack-paths/${serverId}`),
  rebuild:     ()             => api.post('/workflow-governance/attack-paths/rebuild', {}),
  rebuildOne:  (serverId)     => api.post(`/workflow-governance/attack-paths/rebuild/${serverId}`, {}),
}

// --- Prompt Registry (EP-303) ---
export const promptRegistry = {
  list:       ()                 => api.get('/mcp-governance/prompt-registry'),
  get:        (id)               => api.get(`/mcp-governance/prompt-registry/${id}`),
  create:     (body)             => api.post('/mcp-governance/prompt-registry', body),
  update:     (id, body)         => api.put(`/mcp-governance/prompt-registry/${id}`, body),
  approval:   (id, body)         => api.patch(`/mcp-governance/prompt-registry/${id}/approval`, body),
  rollback:   (id, version)      => api.post(`/mcp-governance/prompt-registry/${id}/rollback/${version}`, {}),
  checkDrift: (body)             => api.post('/mcp-governance/prompt-registry/check-drift', body),
}

// --- MCP Governance (registry) ---
export const mcp = {
  listServers:   (status) => api.get(`/mcp-governance/servers${status ? `?status=${status}` : ''}`),
  getServer:     (id)     => api.get(`/mcp-governance/servers/${id}`),
  registerServer:(body)   => api.post('/mcp-governance/servers', body),
  updateServer:  (id, body) => api.put(`/mcp-governance/servers/${id}`, body),
  setServerStatus: (id, body) => api.patch(`/mcp-governance/servers/${id}/status`, body),
  removeServer:  (id)     => api.delete(`/mcp-governance/servers/${id}`),

  listTools:     (serverId) => api.get(`/mcp-governance/servers/${serverId}/tools`),
  addTool:       (serverId, body) => api.post(`/mcp-governance/servers/${serverId}/tools`, body),
  setToolApproval: (id, approval_status, reason) => api.patch(`/mcp-governance/tools/${id}/approval`, { approval_status, reason }),
  removeTool:    (id)     => api.delete(`/mcp-governance/tools/${id}`),
  getToolDecisionHistory:   (id) => api.get(`/mcp-governance/tools/${id}/decision-history`),
  getToolDefinitionHistory: (id) => api.get(`/mcp-governance/tools/${id}/definition-history`),

  // Epic 6, Feature 6.3/6.4 — assurance evidence
  listAssuranceEvidence:  (serverId, params) => api.get(`/mcp-governance/servers/${serverId}/assurance-evidence${params ? `?${new URLSearchParams(params)}` : ''}`),
  submitAssuranceEvidence: (serverId, body) => api.post(`/mcp-governance/servers/${serverId}/assurance-evidence`, body),
  setAssuranceEvidenceStatus: (id, body) => api.patch(`/mcp-governance/assurance-evidence/${id}/status`, body),

  // Epic 6, Feature 6.1 — invocation telemetry
  listInvocations: (params) => api.get(`/mcp-governance/telemetry/mcp-invocations?${new URLSearchParams(params ?? {})}`),

  // EP-101-S8 — claims a credential-exposure finding has been rotated; the
  // finding stays visible until the next scan proves it (fingerprint gone).
  confirmCredentialRotation: (id, confirmedBy) => api.patch(`/mcp-governance/credential-exposure/${id}/confirm-rotation`, { confirmed_by: confirmedBy }),
}
