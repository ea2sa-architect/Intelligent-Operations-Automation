// Zapier Zap metadata extractor.
// Produces the same metadata shape as metadata-extractor.js / make-extractor.js
// so that risk-scorer.js works unchanged.
//
// Note: Zapier API v1 does not expose step field configurations (privacy restriction).
// Node classification uses app-slug heuristics only; parameters_json is always {}.

// App slug prefix → governance type
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

// App slugs that commonly handle PII
const PII_SLUGS = new Set([
  'gmail', 'google-contacts', 'salesforce', 'hubspot', 'stripe',
  'paypal', 'quickbooks', 'freshdesk', 'zendesk', 'bamboohr',
  'workday', 'gusto', 'docusign', 'typeform', 'jotform',
]);

const PII_PATTERNS = {
  email:       /email|e[-_]?mail/i,
  phone:       /phone|mobile|telephone/i,
  credit_card: /credit[-_]?card|payment|billing/i,
  api_key:     /api[-_]?key|apikey|secret/i,
};

function govTypeForSlug(slug = '') {
  const lower = slug.toLowerCase();
  // Exact match first
  if (SLUG_GOV.has(lower)) return SLUG_GOV.get(lower);
  // Prefix match
  for (const [prefix, gov] of SLUG_GOV) {
    if (lower.startsWith(prefix)) return gov;
  }
  return 'unknown';
}

function classifyStep(step) {
  const slug    = step.app?.slug ?? step.type_of ?? '';
  const govType = govTypeForSlug(slug);
  const risks   = [];

  if (govType === 'ai_inference')             risks.push('unreviewed_ai_output');
  if (govType === 'arbitrary_code_execution') risks.push('arbitrary_code_execution');
  if (govType === 'http')                     risks.push('no_auth_header');

  return {
    id:              String(step.id ?? step.type_of ?? Math.random()),
    node_id:         String(step.id ?? step.type_of ?? ''),
    node_name:       step.app?.name ?? step.title ?? slug,
    n8n_type:        slug,
    governance_type: govType,
    risk_factors:    risks,
    parameters_json: {},
    disabled:        false,
    credentials:     {},
  };
}

function detectPII(nodes, zap) {
  const risks = [];
  const seen  = new Set();

  for (const node of nodes) {
    const slug = node.n8n_type.toLowerCase();

    if (PII_SLUGS.has(slug)) {
      for (const [piiType, pattern] of Object.entries(PII_PATTERNS)) {
        if (pattern.test(node.node_name + ' ' + slug) && !seen.has(`${node.node_id}:${piiType}`)) {
          seen.add(`${node.node_id}:${piiType}`);
          risks.push({
            pii_type:       piiType,
            node_name:      node.node_name,
            field_location: 'app-slug-heuristic',
            masked:         false,
            encrypted:      false,
          });
        }
      }
    }
  }

  const hasExternalHttp = nodes.some(n => n.governance_type === 'http' || n.governance_type === 'webhook');
  return {
    hasPII:            risks.length > 0,
    piiFields:         [...new Set(risks.map(r => r.pii_type))],
    risks,
    exposedToExternal: risks.length > 0 && hasExternalHttp,
  };
}

function analyzeErrorHandling(_zap) {
  // Zapier API v1 does not expose error-handling configuration
  return {
    hasTryCatch:        false,
    hasErrorBranches:   false,
    hasRetryLogic:      false,
    retryConfiguration: null,
    saveDataOnError:    false,
  };
}

function extractExternalDeps(nodes) {
  const deps = new Set();
  for (const node of nodes) {
    if (node.governance_type === 'ai_inference') deps.add(`ai:${node.n8n_type}`);
    if (node.governance_type === 'database')     deps.add(`db:${node.n8n_type}`);
    if (node.governance_type === 'http')         deps.add('http:external');
  }
  return [...deps];
}

function extract(zap) {
  const steps = zap.steps ?? [];
  const nodes = steps.map(classifyStep);

  const piiExposure   = detectPII(nodes, zap);
  const errorHandling = analyzeErrorHandling(zap);
  const triggers      = nodes.filter(n =>
    n.governance_type === 'webhook' || n.governance_type === 'schedule'
  );
  const externalDeps = extractExternalDeps(nodes);

  return {
    id:           String(zap.id),
    name:         zap.title ?? `Zap ${zap.id}`,
    nodes,
    dag:          [],
    credentials:  [],
    triggers,
    piiExposure,
    errorHandling,
    externalDeps,
    discoveredAt: new Date().toISOString(),
  };
}

export default { extract };
