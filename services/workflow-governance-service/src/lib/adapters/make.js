// Make.com adapter — full Phase 2 implementation.
// Config shape: { api_key: string, region?: 'eu1'|'us1'|'us2' }
// Make.com API v2: https://{region}.make.com/api/v2

function baseUrl(config) {
  const region = config.region || 'eu1';
  return `https://${region}.make.com/api/v2`;
}

async function request(config, path) {
  const res = await fetch(`${baseUrl(config)}${path}`, {
    headers: {
      'Authorization': `Token ${config.api_key}`,
      'Content-Type':  'application/json',
    },
  });
  if (res.status === 401) throw new Error('Authentication failed — check API key');
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Make.com API error ${res.status}: ${await res.text().catch(() => '')}`);
  return res.json();
}

async function testConnection(config) {
  try {
    if (!config.api_key) return { ok: false, error: 'api_key is required' };
    const data = await request(config, '/users/me');
    if (!data) return { ok: false, error: 'Could not reach Make.com API' };
    return {
      ok:      true,
      error:   null,
      details: { region: config.region || 'eu1', user: data.user?.name ?? data.user?.email },
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Paginate through all scenarios and enrich with folder names.
async function listWorkflows(config) {
  const scenarios = [];
  const limit     = 100;
  let   offset    = 0;

  // Fetch first page to get total count
  while (true) {
    const data = await request(config, `/scenarios?pg[limit]=${limit}&pg[offset]=${offset}`);
    if (!data?.scenarios?.length) break;
    scenarios.push(...data.scenarios);
    if (scenarios.length >= (data.pg?.total ?? 0)) break;
    offset += limit;
  }

  // Enrich with folder names
  const foldersData = await request(config, '/folders').catch(() => null);
  const folderMap   = new Map(
    (foldersData?.folders ?? []).map(f => [f.id, f.name])
  );

  return scenarios.map(s => ({
    sourceId:   String(s.id),
    name:       s.name,
    active:     s.isActive ?? false,
    tags:       [],
    folderId:   s.folderId   ?? null,
    folderName: s.folderId   ? (folderMap.get(s.folderId) ?? `Folder ${s.folderId}`) : null,
    url:        null,
    stepCount:  null,  // only available with blueprint — skip for listing
  }));
}

// Fetch a single scenario with its full blueprint, enriched with folderName.
async function getWorkflow(config, sourceId) {
  const [data, foldersData] = await Promise.all([
    request(config, `/scenarios/${sourceId}`),
    request(config, '/folders').catch(() => null),
  ]);
  if (!data) return null;

  const scenario  = data.scenario ?? data;  // v2 wraps in { scenario: {...} }
  const folderMap = new Map(
    (foldersData?.folders ?? []).map(f => [f.id, f.name])
  );

  return {
    ...scenario,
    folderName: scenario.folderId
      ? (folderMap.get(scenario.folderId) ?? `Folder ${scenario.folderId}`)
      : null,
  };
}

// Produce normalized nodes from a full scenario (with blueprint).
// Stored in workflow_nodes using n8n_type column for the Make module string.
function normalizeNodes(scenario) {
  const modules  = scenario.blueprint?.flow ?? [];
  const prefixGovType = new Map([
    ['gateway',          'webhook'],    ['webhook',          'webhook'],
    ['openai',           'ai_inference'], ['anthropic', 'ai_inference'],
    ['google-vertex-ai', 'ai_inference'], ['perplexityai', 'ai_inference'],
    ['http',             'http'],       ['universal', 'http'],
    ['mysql',            'database'],   ['postgresql', 'database'],
    ['mongodb',          'database'],   ['mariadb', 'database'],
    ['gmail',            'notification'], ['slack', 'notification'],
    ['sendgrid',         'notification'], ['twilio', 'notification'],
    ['teams',            'notification'], ['telegram', 'notification'],
    ['googledrive',      'storage'],    ['dropbox', 'storage'],
    ['box',              'storage'],    ['onedrive', 'storage'],
    ['awss3',            'storage'],    ['googlesheets', 'storage'],
    ['router',           'logic'],      ['filter', 'logic'],
    ['json',             'transform'],  ['xml', 'transform'],
    ['text-parser',      'transform'],  ['tools', 'transform'],
    ['schedule',         'schedule'],   ['clock', 'schedule'],
  ]);

  return modules.map(m => {
    const prefix  = (m.module ?? '').split(':')[0].toLowerCase();
    const govType = prefixGovType.get(prefix) ?? 'unknown';
    return {
      stepId:         String(m.id),
      stepName:       m.name || m.module,
      stepType:       m.module,
      governanceType: govType,
      riskFactors:    [],
      parametersJson: m.parameters ?? {},
    };
  });
}

// Flow-level risks specific to Make.com (beyond per-module risks).
function detectFlowLevelRisks(scenario) {
  const risks   = [];
  const modules = scenario.blueprint?.flow ?? [];
  const meta    = scenario.blueprint?.metadata?.scenario ?? {};

  if (modules.length > 50) risks.push('large_flow');
  if (!meta.maxErrors || meta.maxErrors < 2) risks.push('no_error_handling');
  if (meta.autoCommit === false) risks.push('manual_commit_required');

  const hasAI      = modules.some(m => /openai|anthropic|vertex-ai/i.test(m.module));
  const hasWebhook = modules.some(m => /gateway|webhook/i.test(m.module));
  if (hasAI && hasWebhook) risks.push('webhook_to_ai_path');

  return risks;
}

export default { testConnection, listWorkflows, getWorkflow, normalizeNodes, detectFlowLevelRisks };
