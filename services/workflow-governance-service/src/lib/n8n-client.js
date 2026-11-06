// n8n Cloud REST API client
// Docs: https://docs.n8n.io/api/api-reference/
//
// Every function takes an optional trailing `config` ({ base_url, api_key })
// so a caller can point this at the n8n instance stored in a
// workflow_governance.platform_connections row (set via the Integrations
// admin UI) instead of the platform-wide N8N_BASE_URL/N8N_API_KEY env vars.
// Falls back to the env vars when config is omitted or incomplete, so
// nothing calling this without a connection (or in a dev setup with no
// connections configured at all) changes behavior.

const BASE_URL = process.env.N8N_BASE_URL || 'https://ea2sa.app.n8n.cloud/api/v1';
const API_KEY  = process.env.N8N_API_KEY;

async function request(path, config = {}) {
  const baseUrl = config.base_url || BASE_URL;
  const apiKey  = config.api_key  || API_KEY;
  if (!apiKey) throw new Error('N8N_API_KEY environment variable is not set');
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, {
    headers: {
      'X-N8N-API-KEY': apiKey,
      'Content-Type': 'application/json',
    },
  });
  if (res.status === 401) throw new Error('n8n API authentication failed — check the configured API key');
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`n8n API error ${res.status}: ${body}`);
  }
  return res.json();
}

// Fetch all workflows (paginated internally, returns full list)
async function listWorkflows(config = {}) {
  const workflows = [];
  let cursor = null;
  do {
    const qs = cursor ? `?cursor=${cursor}&limit=100` : '?limit=100';
    const page = await request(`/workflows${qs}`, config);
    if (!page) break;
    workflows.push(...(page.data || []));
    cursor = page.nextCursor || null;
  } while (cursor);
  return workflows;
}

// Fetch a single workflow's full definition
async function getWorkflow(id, config = {}) {
  return request(`/workflows/${id}`, config);
}

// Fetch all projects — returns [{ id, name, type, ... }]
// Falls back to empty array on 404 (n8n instances that don't support projects)
async function listProjects(config = {}) {
  const data = await request('/projects', config).catch(() => null);
  if (!data) return [];
  // API may return { data: [...] } or a plain array depending on version
  return Array.isArray(data) ? data : (data.data || []);
}

// Fetch recent executions for a workflow
async function getExecutions(workflowId, { limit = 20 } = {}, config = {}) {
  const data = await request(`/executions?workflowId=${workflowId}&limit=${limit}&includeData=false`, config);
  return data?.data || [];
}

// Fetch credential metadata (no values exposed)
async function listCredentials(config = {}) {
  const data = await request('/credentials', config);
  return data?.data || [];
}

// Human-facing n8n UI deep link for a specific execution, e.g. for the Data
// Lineage page's "Open in n8n" action — distinct from BASE_URL, which is
// the management API root (ends in /api/v1). Same strip pattern already
// used in workflows.js for webhook trigger URLs. Returns null if either id
// is missing, so callers can render the link conditionally.
function buildExecutionUrl(workflowId, executionId, config = {}) {
  if (!workflowId || !executionId) return null;
  const root = (config.base_url || process.env.N8N_BASE_URL || BASE_URL).replace(/\/api\/v1\/?$/, '');
  return `${root}/workflow/${workflowId}/executions/${executionId}`;
}

export default { listWorkflows, getWorkflow, listProjects, getExecutions, listCredentials, buildExecutionUrl };
