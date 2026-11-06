/**
 * Camunda adapter — supports C8 Cloud (SaaS), C8 Self-managed, and C7.
 *
 * Config shapes:
 *   C8 Cloud:        { mode: 'cloud',        client_id, client_secret, cluster_id, region }
 *   C8 Self-managed: { mode: 'self_managed',  base_url, client_id, client_secret }
 *   C7:              { mode: 'c7',            base_url, username, password }
 *
 * C8 uses the Camunda Operate REST API (process definitions + BPMN XML).
 * C7 uses the Camunda BPM REST API (/engine-rest).
 */

// In-memory OAuth2 token cache keyed by client_id
const tokenCache = new Map();

// ── URL helpers ──────────────────────────────────────────────────────────────

function apiBaseUrl(config) {
  switch (config.mode) {
    case 'cloud':
      return `https://${config.region}.operate.camunda.io/${config.cluster_id}`;
    case 'self_managed':
      return config.base_url.replace(/\/$/, '');
    case 'c7':
      return `${config.base_url.replace(/\/$/, '')}/engine-rest`;
    default:
      throw new Error(`Unknown Camunda mode: ${config.mode}`);
  }
}

function tokenUrl(config) {
  if (config.mode === 'cloud') {
    return 'https://login.cloud.camunda.io/oauth/token';
  }
  // C8 self-managed uses an embedded Keycloak
  return `${config.base_url.replace(/\/$/, '')}/auth/realms/camunda-platform/protocol/openid-connect/token`;
}

// ── Auth ─────────────────────────────────────────────────────────────────────

async function fetchOAuthToken(config) {
  const params = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     config.client_id,
    client_secret: config.client_secret,
  });
  if (config.mode === 'cloud') {
    params.set('audience', 'operate.camunda.io');
  }

  const res = await fetch(tokenUrl(config), {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    params.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Camunda OAuth failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  return { token: data.access_token, ttl: (data.expires_in ?? 3600) * 1000 };
}

async function getBearerToken(config) {
  const key    = config.client_id;
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now() + 30_000) return cached.token;

  const { token, ttl } = await fetchOAuthToken(config);
  tokenCache.set(key, { token, expiresAt: Date.now() + ttl });
  return token;
}

async function buildHeaders(config) {
  if (config.mode === 'c7') {
    const creds = Buffer.from(`${config.username}:${config.password}`).toString('base64');
    return { 'Authorization': `Basic ${creds}`, 'Content-Type': 'application/json' };
  }
  const token = await getBearerToken(config);
  return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
}

// ── HTTP helper ──────────────────────────────────────────────────────────────

async function request(config, path, { text = false } = {}) {
  const headers = await buildHeaders(config);
  const res = await fetch(`${apiBaseUrl(config)}${path}`, { headers });

  if (res.status === 401) throw new Error('Authentication failed — check credentials');
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Camunda API error ${res.status}: ${body.slice(0, 200)}`);
  }
  return text ? res.text() : res.json();
}

// ── Normalisation ────────────────────────────────────────────────────────────

function normalise(def, mode) {
  const sourceId = mode === 'c7' ? String(def.id) : String(def.key);
  return {
    sourceId,
    name:      def.name || def.bpmnProcessId || `Process ${sourceId}`,
    active:    mode === 'c7' ? !def.suspended : true,
    folderId:  null,
    folderName: def.tenantId ?? null,
    stepCount:  null,
    tags:       [],
    version:    def.version ?? null,
    bpmnProcessId: def.bpmnProcessId ?? def.key ?? null,
  };
}

// ── Adapter interface ────────────────────────────────────────────────────────

async function testConnection(config) {
  try {
    if (config.mode === 'cloud') {
      if (!config.client_id || !config.client_secret || !config.cluster_id || !config.region) {
        return { ok: false, error: 'client_id, client_secret, cluster_id, and region are required' };
      }
    } else if (config.mode === 'self_managed') {
      if (!config.base_url || !config.client_id || !config.client_secret) {
        return { ok: false, error: 'base_url, client_id, and client_secret are required' };
      }
    } else if (config.mode === 'c7') {
      if (!config.base_url || !config.username || !config.password) {
        return { ok: false, error: 'base_url, username, and password are required' };
      }
    } else {
      return { ok: false, error: 'mode must be cloud, self_managed, or c7' };
    }

    const path = config.mode === 'c7'
      ? '/process-definition?maxResults=1'
      : '/v1/process-definitions?size=1';
    const data = await request(config, path);
    if (!data) return { ok: false, error: 'Could not reach Camunda API' };

    const total = config.mode === 'c7'
      ? (Array.isArray(data) ? data.length : 0)
      : (data.total ?? data.items?.length ?? 0);

    return { ok: true, error: null, details: { mode: config.mode, definitions: total } };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function listWorkflows(config) {
  const results = [];

  if (config.mode === 'c7') {
    let firstResult = 0;
    const maxResults = 100;
    while (true) {
      const data = await request(config,
        `/process-definition?maxResults=${maxResults}&firstResult=${firstResult}&latestVersion=true`
      );
      if (!Array.isArray(data) || data.length === 0) break;
      for (const def of data) results.push(normalise(def, 'c7'));
      if (data.length < maxResults) break;
      firstResult += maxResults;
    }
  } else {
    let page = 0;
    const size = 100;
    while (true) {
      const data = await request(config, `/v1/process-definitions?size=${size}&page=${page}`);
      if (!data?.items?.length) break;
      for (const def of data.items) results.push(normalise(def, config.mode));
      if (results.length >= (data.total ?? 0)) break;
      page++;
    }
  }

  return results;
}

async function getWorkflow(config, sourceId) {
  let def, bpmnXml;

  if (config.mode === 'c7') {
    def = await request(config, `/process-definition/${sourceId}`);
    const xmlData = await request(config, `/process-definition/${sourceId}/xml`);
    bpmnXml = xmlData?.bpmn20Xml ?? '';
  } else {
    def = await request(config, `/v1/process-definitions/${sourceId}`);
    bpmnXml = await request(config, `/v1/process-definitions/${sourceId}/xml`, { text: true }) ?? '';
  }

  if (!def) return null;

  return {
    ...def,
    id:       sourceId,
    name:     def.name || def.bpmnProcessId || `Process ${sourceId}`,
    bpmnXml,
  };
}

function normalizeNodes(_process) {
  // Delegated to camunda-extractor.extract() in the import route
  return [];
}

function detectFlowLevelRisks(process) {
  const xml   = process.bpmnXml ?? '';
  const risks = [];

  if (/scriptTask\b/.test(xml))                                          risks.push('arbitrary_code_execution');
  if ((xml.match(/<(?:[a-z]+:)?serviceTask\b/gi) ?? []).length > 20)    risks.push('large_flow');
  if (/aws-bedrock|openai-connector|anthropic-connector/.test(xml))      risks.push('unreviewed_ai_output');
  if (/messageEventDefinition/.test(xml) && /openai|anthropic|bedrock/.test(xml)) {
    risks.push('webhook_to_ai_path');
  }
  if (!/errorEventDefinition|boundaryEvent/.test(xml))                   risks.push('no_error_handling');
  if (/callActivity\b/.test(xml))                                        risks.push('cross_process_call');

  return risks;
}

export default { testConnection, listWorkflows, getWorkflow, normalizeNodes, detectFlowLevelRisks };
