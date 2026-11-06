// Zapier adapter — full implementation.
// Config: { api_key }
//
// Note: Zapier API v1 does not expose step field configurations (privacy restriction).
// normalizeNodes() classifies steps by app slug only; parameters_json is always {}.

async function request(config, path) {
  const res = await fetch(`https://api.zapier.com/v1${path}`, {
    headers: {
      'Authorization': `Bearer ${config.api_key}`,
      'Content-Type':  'application/json',
    },
  })
  if (res.status === 401) throw new Error('Authentication failed — check API key')
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Zapier API error ${res.status}`)
  return res.json()
}

async function testConnection(config) {
  try {
    if (!config.api_key) return { ok: false, error: 'api_key is required' }
    const data = await request(config, '/profiles/me')
    if (!data) return { ok: false, error: 'Could not reach Zapier API' }
    return { ok: true, error: null, details: { user: data.email } }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

// Paginate through all Zaps in the account.
async function listWorkflows(config) {
  const results = [];
  const limit   = 100;
  let   offset  = 0;

  while (true) {
    const data = await request(config, `/zaps?limit=${limit}&offset=${offset}`);
    if (!data?.objects?.length) break;

    for (const zap of data.objects) {
      results.push({
        sourceId:  String(zap.id),
        name:      zap.title ?? `Zap ${zap.id}`,
        active:    zap.status === 'on',
        folderId:  null,
        folderName: null,
        stepCount: zap.steps?.length ?? null,
        tags:      [],
        steps:     zap.steps ?? [],
      });
    }

    if (!data.next || results.length >= (data.count ?? Infinity)) break;
    offset += limit;
  }

  return results;
}

// Fetch a single Zap with full step detail.
async function getWorkflow(config, sourceId) {
  const data = await request(config, `/zaps/${sourceId}`);
  if (!data) return null;
  // v1 returns { objects: [zap] } for single-zap endpoints
  return data.objects?.[0] ?? data;
}

// App slugs → governance type (mirrors zapier-extractor.js classification)
const SLUG_GOV = new Map([
  ['openai',           'ai_inference'],
  ['chatgpt',          'ai_inference'],
  ['anthropic',        'ai_inference'],
  ['google-ai',        'ai_inference'],
  ['cohere',           'ai_inference'],
  ['perplexity',       'ai_inference'],
  ['hugging-face',     'ai_inference'],
  ['webhooks',         'webhook'],
  ['webhook',          'webhook'],
  ['code-by-zapier',   'arbitrary_code_execution'],
  ['mysql',            'database'],
  ['postgresql',       'database'],
  ['mongodb',          'database'],
  ['airtable',         'database'],
  ['google-sheets',    'storage'],
  ['dropbox',          'storage'],
  ['box',              'storage'],
  ['onedrive',         'storage'],
  ['aws-s3',           'storage'],
  ['gmail',            'notification'],
  ['slack',            'notification'],
  ['sendgrid',         'notification'],
  ['twilio',           'notification'],
  ['microsoft-teams',  'notification'],
  ['mailchimp',        'notification'],
  ['http',             'http'],
  ['delay',            'logic'],
  ['filter',           'logic'],
  ['paths',            'logic'],
  ['formatter',        'transform'],
  ['schedule',         'schedule'],
]);

function govTypeForSlug(slug = '') {
  const lower = slug.toLowerCase();
  if (SLUG_GOV.has(lower)) return SLUG_GOV.get(lower);
  for (const [prefix, gov] of SLUG_GOV) {
    if (lower.startsWith(prefix)) return gov;
  }
  return 'unknown';
}

// Produce governance-normalised nodes from a full Zap object.
function normalizeNodes(zap) {
  return (zap.steps ?? []).map(step => {
    const slug    = step.app?.slug ?? step.type_of ?? '';
    const govType = govTypeForSlug(slug);
    const risks   = [];

    if (govType === 'ai_inference')             risks.push('unreviewed_ai_output');
    if (govType === 'arbitrary_code_execution') risks.push('arbitrary_code_execution');
    if (govType === 'http')                     risks.push('no_auth_header');

    return {
      stepId:         String(step.id ?? ''),
      stepName:       step.app?.name ?? step.title ?? slug,
      stepType:       slug,
      governanceType: govType,
      riskFactors:    risks,
      parametersJson: {},
    };
  });
}

// Flow-level risks derived from the full Zap's step list.
function detectFlowLevelRisks(zap) {
  const risks = [];
  const steps = zap.steps ?? [];
  const slugs = steps.map(s => (s.app?.slug ?? '').toLowerCase());

  if (steps.length > 20) risks.push('large_flow');

  const hasAi      = slugs.some(s => ['openai','chatgpt','anthropic','google-ai','cohere','perplexity','hugging-face'].includes(s));
  const hasWebhook = slugs.some(s => s === 'webhooks' || s === 'webhook');
  const hasCode    = slugs.some(s => s === 'code-by-zapier');

  if (hasAi && hasWebhook) risks.push('webhook_to_ai_path');
  if (hasCode)             risks.push('arbitrary_code_execution');
  if (hasAi)               risks.push('unreviewed_ai_output');

  return risks;
}

export default { testConnection, listWorkflows, getWorkflow, normalizeNodes, detectFlowLevelRisks }
