// Make.com scenario metadata extractor.
// Produces the same metadata shape as metadata-extractor.js so risk-scorer.js works unchanged.

import crypto from 'crypto';

// Map Make module app-prefix → governance type
const MODULE_GOV_TYPE = new Map([
  ['gateway',          'webhook'],
  ['webhook',          'webhook'],
  ['openai',           'ai_inference'],
  ['anthropic',        'ai_inference'],
  ['google-vertex-ai', 'ai_inference'],
  ['perplexityai',     'ai_inference'],
  ['stabilityai',      'ai_inference'],
  ['cohere',           'ai_inference'],
  ['http',             'http'],
  ['universal',        'http'],
  ['mysql',            'database'],
  ['postgresql',       'database'],
  ['mongodb',          'database'],
  ['mariadb',          'database'],
  ['mssql',            'database'],
  ['gmail',            'notification'],
  ['slack',            'notification'],
  ['sendgrid',         'notification'],
  ['mailchimp',        'notification'],
  ['twilio',           'notification'],
  ['teams',            'notification'],
  ['telegram',         'notification'],
  ['googledrive',      'storage'],
  ['dropbox',          'storage'],
  ['box',              'storage'],
  ['onedrive',         'storage'],
  ['awss3',            'storage'],
  ['googlesheets',     'storage'],
  ['router',           'logic'],
  ['filter',           'logic'],
  ['json',             'transform'],
  ['xml',              'transform'],
  ['text-parser',      'transform'],
  ['tools',            'transform'],
  ['string',           'transform'],
  ['math',             'transform'],
  ['schedule',         'schedule'],
  ['clock',            'schedule'],
]);

const PII_PATTERNS = {
  email:       /email|e[-_]?mail|mail[-_]?address/i,
  ssn:         /ssn|social[-_]?security|tax[-_]?id/i,
  phone:       /phone|telephone|mobile|cell[-_]?num/i,
  credit_card: /credit[-_]?card|card[-_]?num|cc[-_]?num/i,
  password:    /password|passwd|pwd/i,
  api_key:     /api[-_]?key|apikey|secret[-_]?key/i,
  dob:         /date[-_]?of[-_]?birth|dob|birthday/i,
  address:     /street[-_]?addr|postal|zip[-_]?code/i,
};

// EP-101-S1 — same deterministic-pattern, redact-and-fingerprint approach as
// metadata-extractor.js's scanForSecrets, duplicated rather than imported
// (each extractor is a standalone pure-function module, same rationale as
// credential-scanner.js's cross-service duplication). Make module
// `parameters` were previously stored raw/unredacted with no scanning at all.
const SECRET_PATTERNS = {
  openai_key:     /sk-[A-Za-z0-9]{20,}/g,
  anthropic_key:  /sk-ant-[A-Za-z0-9-]{20,}/g,
  aws_access_key: /AKIA[0-9A-Z]{16}/g,
  github_token:   /gh[pousr]_[A-Za-z0-9]{30,}/g,
  slack_token:    /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  bearer_token:   /Bearer\s+[A-Za-z0-9\-_.]{20,}/g,
  // Make's mysql/postgresql/mongodb/mariadb/mssql modules commonly take a
  // connection URI with embedded credentials.
  basic_auth_url: /[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/\s:@]+:[^/\s:@]+@/g,
};

function fingerprintSecret(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

// Keeps first/last 4 chars only — enough to eyeball "is this the right key
// rotated or not" without ever exposing the usable secret.
function redactSecret(value) {
  return value.length <= 8 ? '****' : `${value.slice(0, 4)}****${value.slice(-4)}`;
}

// Scans a module's raw parameters for hardcoded secrets and returns both the
// findings (redacted preview + fingerprint only — never the raw match) and a
// redacted copy of the parameters, safe to persist/log.
function scanForSecrets(parameters) {
  const raw = JSON.stringify(parameters || {});
  const findings = [];
  let redacted = raw;

  for (const [secretType, pattern] of Object.entries(SECRET_PATTERNS)) {
    for (const match of raw.match(pattern) || []) {
      findings.push({
        secret_type: secretType,
        redacted_preview: redactSecret(match),
        fingerprint_sha256: fingerprintSecret(match),
      });
      redacted = redacted.split(match).join(redactSecret(match));
    }
  }

  return { findings, redactedParameters: findings.length ? JSON.parse(redacted) : (parameters || {}) };
}

function appPrefix(moduleId = '') {
  return moduleId.split(':')[0].toLowerCase();
}

function classifyModule(mod) {
  const prefix  = appPrefix(mod.module ?? '');
  const govType = MODULE_GOV_TYPE.get(prefix) ?? 'unknown';
  const risks   = [];
  const params  = JSON.stringify(mod.parameters ?? {});
  const { findings: secretFindings, redactedParameters } = scanForSecrets(mod.parameters);
  if (secretFindings.length > 0) risks.push('hardcoded_secret');

  if (govType === 'ai_inference') {
    if (!/max_?tokens|maxTokens/i.test(params)) risks.push('no_token_limit');
    if (!/system_?message|system_?prompt/i.test(params)) risks.push('no_system_prompt');
  }
  if (govType === 'http') {
    const url = String(mod.parameters?.url ?? mod.parameters?.uri ?? '');
    if (url.startsWith('http://')) risks.push('unencrypted_http');
    if (!mod.parameters?.headers && !/auth/i.test(params)) risks.push('no_auth_header');
    if (!mod.parameters?.timeout) risks.push('no_timeout');
  }
  if (govType === 'database') {
    if (/query|raw_?sql|execute/i.test(params)) risks.push('raw_sql_execution');
  }
  if (govType === 'transform') {
    risks.push('arbitrary_code_execution');
  }

  return {
    id:              String(mod.id),
    node_id:         String(mod.id),
    node_name:       mod.name || mod.module,
    n8n_type:        mod.module,   // repurposed to store Make module ID
    governance_type: govType,
    risk_factors:    risks,
    // Redacted before it ever reaches storage/logs — the raw match never leaves scanForSecrets.
    parameters_json: redactedParameters,
    secret_findings: secretFindings,
    disabled:        mod.disabled ?? false,
    credentials:     {},
  };
}

// Aggregates the per-module secret_findings (already redacted/fingerprinted
// in classifyModule) into the same shape metadata-extractor.js's
// detectHardcodedSecrets uses, so workflows.js's persistence code (which
// reads `metadata.secretExposure?.risks`) works unchanged for Make imports.
function detectHardcodedSecrets(classifiedNodes) {
  const risks = [];
  for (const node of classifiedNodes) {
    for (const finding of node.secret_findings || []) {
      risks.push({
        secret_type: finding.secret_type,
        node_name: node.node_name,
        redacted_preview: finding.redacted_preview,
        fingerprint_sha256: finding.fingerprint_sha256,
      });
    }
  }
  return { hasSecrets: risks.length > 0, risks };
}

function detectPII(classifiedNodes) {
  const piiFields = new Set();
  const risks     = [];

  for (const node of classifiedNodes) {
    const paramStr = JSON.stringify(node.parameters_json);
    for (const [piiType, pattern] of Object.entries(PII_PATTERNS)) {
      if (pattern.test(paramStr)) {
        piiFields.add(piiType);
        risks.push({
          pii_type:       piiType,
          node_name:      node.node_name,
          field_location: 'parameter',
          masked:         /\*{3,}|redact|mask/i.test(paramStr),
          encrypted:      /encrypt|cipher/i.test(paramStr),
        });
      }
    }
  }

  const hasExternalHttp = classifiedNodes.some(n => n.governance_type === 'http');
  return {
    hasPII:            piiFields.size > 0,
    piiFields:         [...piiFields],
    risks,
    exposedToExternal: piiFields.size > 0 && hasExternalHttp,
  };
}

function analyzeErrorHandling(scenario) {
  const modules = scenario.blueprint?.flow ?? [];
  // Make modules can set ignore:true to swallow errors (like try/catch)
  const hasIgnoreErrors   = modules.some(m => m.ignore === true);
  // Router module provides branching / fallback paths
  const hasRouterFallback = modules.some(m => appPrefix(m.module) === 'router');
  // Blueprint-level maxErrors config
  const maxErrors = scenario.blueprint?.metadata?.scenario?.maxErrors;
  const hasRetryLogic = maxErrors != null && maxErrors > 1;

  return {
    hasTryCatch:        hasIgnoreErrors,
    hasErrorBranches:   hasRouterFallback,
    hasRetryLogic,
    retryConfiguration: hasRetryLogic
      ? { maxRetries: maxErrors, backoffType: 'fixed', backoffBaseMs: 1000 }
      : null,
    saveDataOnError: false,
  };
}

function extractExternalDeps(classifiedNodes) {
  const deps = new Set();
  for (const node of classifiedNodes) {
    if (node.governance_type === 'http') {
      const url = String(node.parameters_json?.url ?? node.parameters_json?.uri ?? '');
      try {
        const { hostname } = new URL(url);
        deps.add(`http:${hostname}`);
      } catch {}
    }
    if (node.governance_type === 'ai_inference') deps.add(`ai:${appPrefix(node.n8n_type)}`);
    if (node.governance_type === 'database')     deps.add(`db:${appPrefix(node.n8n_type)}`);
  }
  return [...deps];
}

function extract(scenario) {
  const modules        = scenario.blueprint?.flow ?? [];
  const classifiedNodes = modules.map(classifyModule);
  const piiExposure    = detectPII(classifiedNodes);
  const secretExposure = detectHardcodedSecrets(classifiedNodes);
  const errorHandling  = analyzeErrorHandling(scenario);
  const triggers       = classifiedNodes.filter(n =>
    n.governance_type === 'webhook' || n.governance_type === 'schedule'
  );
  const externalDeps   = extractExternalDeps(classifiedNodes);

  return {
    id:           String(scenario.id),
    name:         scenario.name,
    nodes:        classifiedNodes,
    dag:          [],
    credentials:  [],
    triggers,
    piiExposure,
    secretExposure,
    errorHandling,
    externalDeps,
    discoveredAt: new Date().toISOString(),
  };
}

export default { extract, classifyModule, detectHardcodedSecrets };
