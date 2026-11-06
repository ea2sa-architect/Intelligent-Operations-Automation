// n8n adapter — wraps the existing n8n-client and maps to the standard adapter interface.
// Config: { api_key, base_url }

import n8nClient from '../n8n-client.js';

async function testConnection(config) {
  try {
    const baseUrl = config.base_url || process.env.N8N_BASE_URL;
    const apiKey  = config.api_key  || process.env.N8N_API_KEY;
    if (!apiKey) return { ok: false, error: 'api_key is required' };

    const res = await fetch(`${baseUrl}/workflows?limit=1`, {
      headers: { 'X-N8N-API-KEY': apiKey, 'Content-Type': 'application/json' },
    });
    if (res.status === 401) return { ok: false, error: 'Authentication failed — check API key' };
    if (!res.ok) return { ok: false, error: `n8n returned HTTP ${res.status}` };

    // HTTP 200 alone isn't proof the Instance URL is actually pointed at
    // n8n's API — a wrong URL (e.g. missing /api/v1) commonly still
    // returns 200 with n8n's web UI HTML via its SPA catch-all route,
    // which previously made this report a false "Connected" (caught live:
    // Test showed Connected on a URL that Discover then failed against
    // with "Unexpected token '<'... is not valid JSON").
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return {
        ok: false,
        error: `n8n returned ${contentType || 'a non-JSON response'} instead of JSON — check the Instance URL includes the API path (e.g. .../api/v1)`,
      };
    }
    let body;
    try {
      body = await res.json();
    } catch {
      return {
        ok: false,
        error: 'n8n returned a response that is not valid JSON — check the Instance URL includes the API path (e.g. .../api/v1)',
      };
    }
    if (!body || !Array.isArray(body.data)) {
      return { ok: false, error: 'Unexpected response shape from n8n — check the Instance URL' };
    }

    return { ok: true, error: null, details: { base_url: baseUrl } };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function listWorkflows(config) {
  const workflows = await n8nClient.listWorkflows(config);
  const projects  = await n8nClient.listProjects(config).catch(() => []);
  const projectMap = Object.fromEntries(projects.map(p => [p.id, p.name]));

  return workflows.map(wf => ({
    sourceId:   String(wf.id),
    name:       wf.name,
    active:     wf.active,
    tags:       (wf.tags ?? []).map(t => (typeof t === 'string' ? t : t.name)),
    folderId:   wf.projectId ?? null,
    folderName: wf.projectId ? (projectMap[wf.projectId] ?? null) : null,
    url:        null,
    stepCount:  wf.nodes?.length ?? 0,
  }));
}

async function getWorkflow(config, sourceId) {
  return n8nClient.getWorkflow(sourceId, config);
}

function normalizeNodes(raw) {
  return (raw.nodes ?? []).map(n => ({
    stepId:         n.id,
    stepName:       n.name,
    stepType:       n.type,
    governanceType: classifyN8nNode(n.type),
    riskFactors:    [],
    parametersJson: n.parameters ?? {},
  }));
}

function detectFlowLevelRisks(_raw) {
  return [];
}

function classifyN8nNode(type = '') {
  const t = type.toLowerCase();
  if (t.includes('openai') || t.includes('anthropic') || t.includes('lmchat') || t.includes('@n8n/n8n-nodes-langchain'))
    return 'ai_inference';
  if (t.includes('postgres') || t.includes('mysql') || t.includes('mongodb') || t.includes('redis'))
    return 'database';
  if (t.includes('httprequest') || t.includes('http'))   return 'http';
  if (t.includes('webhook'))                              return 'webhook';
  if (t.includes('schedule') || t.includes('cron'))      return 'schedule';
  if (t.includes('email') || t.includes('slack') || t.includes('telegram')) return 'notification';
  if (t.includes('s3') || t.includes('googledrive') || t.includes('dropbox')) return 'storage';
  if (t.includes('if') || t.includes('switch') || t.includes('merge'))  return 'logic';
  if (t.includes('set') || t.includes('function') || t.includes('code')) return 'transform';
  if (t.includes('credential'))                           return 'credential';
  return 'unknown';
}

export default { testConnection, listWorkflows, getWorkflow, normalizeNodes, detectFlowLevelRisks };
