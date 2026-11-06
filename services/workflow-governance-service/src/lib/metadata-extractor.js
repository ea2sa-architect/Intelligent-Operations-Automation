import crypto from 'crypto';

// Maps n8n node types to governance categories
const NODE_TYPE_MAP = {
  // AI inference
  'n8n-nodes-base.openAi':            'ai_inference',
  'n8n-nodes-base.openai':            'ai_inference',
  '@n8n/n8n-nodes-langchain.openAi':  'ai_inference',
  'n8n-nodes-base.anthropic':         'ai_inference',
  '@n8n/n8n-nodes-langchain.lmChatAnthropic': 'ai_inference',
  'n8n-nodes-base.mistral':           'ai_inference',
  '@n8n/n8n-nodes-langchain.lmChatMistralCloud': 'ai_inference',
  '@n8n/n8n-nodes-langchain.lmChatOllama': 'ai_inference',
  '@n8n/n8n-nodes-langchain.lmChatOpenAi': 'ai_inference',
  '@n8n/n8n-nodes-langchain.agent':   'ai_inference',
  // HTTP
  'n8n-nodes-base.httpRequest':       'http',
  'n8n-nodes-base.http':              'http',
  // Database
  'n8n-nodes-base.postgres':          'database',
  'n8n-nodes-base.mysql':             'database',
  'n8n-nodes-base.mongoDb':           'database',
  'n8n-nodes-base.redis':             'database',
  'n8n-nodes-base.supabase':          'database',
  // Approval / wait
  'n8n-nodes-base.wait':              'approval',
  'n8n-nodes-base.humanApproval':     'approval',
  // Logic
  'n8n-nodes-base.if':                'logic',
  'n8n-nodes-base.switch':            'logic',
  'n8n-nodes-base.merge':             'logic',
  'n8n-nodes-base.splitInBatches':    'logic',
  // Transform / code
  'n8n-nodes-base.code':              'transform',
  'n8n-nodes-base.function':          'transform',
  'n8n-nodes-base.functionItem':      'transform',
  'n8n-nodes-base.set':               'transform',
  'n8n-nodes-base.itemLists':         'transform',
  // Storage
  'n8n-nodes-base.s3':                'storage',
  'n8n-nodes-base.googleDrive':       'storage',
  'n8n-nodes-base.dropbox':           'storage',
  'n8n-nodes-base.readBinaryFile':    'storage',
  'n8n-nodes-base.writeBinaryFile':   'storage',
  // Notification
  'n8n-nodes-base.slack':             'notification',
  'n8n-nodes-base.emailSend':         'notification',
  'n8n-nodes-base.gmail':             'notification',
  'n8n-nodes-base.telegram':          'notification',
  'n8n-nodes-base.sendGrid':          'notification',
  // Triggers / webhooks
  'n8n-nodes-base.webhook':           'webhook',
  'n8n-nodes-base.webhookTrigger':    'webhook',
  // Schedule
  'n8n-nodes-base.scheduleTrigger':   'schedule',
  'n8n-nodes-base.cron':              'schedule',
  // MCP client — best-effort known type strings; classifyNode also falls
  // back to a name-based match below for MCP node variants not listed here.
  '@n8n/n8n-nodes-langchain.mcpClientTool': 'mcp_client',
  '@n8n/n8n-nodes-langchain.mcpClient':     'mcp_client',
};

// Parameter keys n8n's MCP-client node commonly uses for the server endpoint.
// Best-effort — verify/extend against a real captured node definition once
// one is available; the extraction degrades to the node name if none match.
const MCP_SERVER_REF_KEYS = ['endpointUrl', 'sseEndpoint', 'serverUrl', 'url', 'endpoint'];

const PII_PATTERNS = {
  email:      /email|e[-_]?mail|mail[-_]?address/i,
  ssn:        /ssn|social[-_]?security|tax[-_]?id/i,
  phone:      /phone|telephone|mobile|cell[-_]?num/i,
  credit_card:/credit[-_]?card|card[-_]?num|cc[-_]?num/i,
  password:   /password|passwd|pwd/i,
  api_key:    /api[-_]?key|apikey|secret[-_]?key/i,
  dob:        /date[-_]?of[-_]?birth|dob|birthday/i,
  address:    /street[-_]?addr|postal|zip[-_]?code/i,
};

// Deterministic patterns first — matches literal secret *values*, not field
// names (PII_PATTERNS above matches field names; this is a distinct, stronger
// signal: an actual credential-shaped string embedded in a parameter).
const SECRET_PATTERNS = {
  openai_key:     /sk-[A-Za-z0-9]{20,}/g,
  anthropic_key:  /sk-ant-[A-Za-z0-9-]{20,}/g,
  aws_access_key: /AKIA[0-9A-Z]{16}/g,
  github_token:   /gh[pousr]_[A-Za-z0-9]{30,}/g,
  slack_token:    /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  bearer_token:   /Bearer\s+[A-Za-z0-9\-_.]{20,}/g,
  // Mirrors mcp-governance-service/src/lib/credential-scanner.js's MCP-specific
  // addition — n8n's database node types (postgres, mysql, mongoDb, redis,
  // supabase) commonly take a connection URI with embedded credentials.
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

// Scans a node's raw parameters for hardcoded secrets and returns both the
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

// Extracts whatever string the node uses to identify its MCP server —
// preferring an explicit endpoint/URL parameter, falling back to the node
// name so an unresolvable reference still surfaces rather than disappearing.
// Epic 2, Feature 2.1: the fallback case is reported as malformed — a
// server_reference recovered only from the node's own name can't be
// confidently resolved against the registry and needs investigation.
function extractMcpServerReference(node) {
  for (const key of MCP_SERVER_REF_KEYS) {
    const value = node.parameters?.[key] ?? node.parameters?.options?.[key];
    if (typeof value === 'string' && value.trim()) return { reference: value.trim(), malformed: false, malformedReason: null };
  }
  return { reference: node.name, malformed: true, malformedReason: `No recognized server-reference parameter (checked: ${MCP_SERVER_REF_KEYS.join(', ')}) — using node name as a fallback` };
}

function classifyNode(node) {
  const matchedType = NODE_TYPE_MAP[node.type];
  // Epic 2, Feature 2.1: a node classified as mcp_client only because its
  // type string happens to contain "mcp" — not because it matches a known
  // MCP client type — is a distinct, weaker signal than an exact match. We
  // don't actually know this node's parameter shape, so its reference can
  // never be more than a guess.
  const isMcpNameFallbackMatch = !matchedType && /mcp/i.test(node.type || '');
  const govType = matchedType || (isMcpNameFallbackMatch ? 'mcp_client' : 'unknown');
  const risks = [];
  const params = JSON.stringify(node.parameters || {});
  const { findings: secretFindings, redactedParameters } = scanForSecrets(node.parameters);
  if (secretFindings.length > 0) risks.push('hardcoded_secret');

  if (govType === 'ai_inference') {
    if (!node.parameters?.maxTokens && !node.parameters?.options?.maxTokens) risks.push('no_token_limit');
    if (!node.parameters?.systemMessage && !node.parameters?.systemPrompt) risks.push('no_system_prompt');
    const model = node.parameters?.model || node.parameters?.options?.model || '';
    if (typeof model === 'string' && model.includes('gpt-3.5')) risks.push('deprecated_model');
  }
  if (govType === 'http') {
    const url = String(node.parameters?.url || node.parameters?.options?.url || '');
    if (url.startsWith('http://')) risks.push('unencrypted_http');
    if (!node.parameters?.authentication && !node.parameters?.headerParameters) risks.push('no_auth_header');
    if (!node.parameters?.timeout && !node.parameters?.options?.timeout) risks.push('no_timeout');
  }
  if (govType === 'transform') {
    risks.push('arbitrary_code_execution');
    const code = String(node.parameters?.jsCode || node.parameters?.functionCode || '');
    if (/require\s*\(/.test(code)) risks.push('file_system_access');
    if (/process\.env/.test(code)) risks.push('env_access');
  }
  if (govType === 'database') {
    if (node.parameters?.operation === 'executeQuery' || node.parameters?.query) risks.push('raw_sql_execution');
  }
  let mcpServerReference = null;
  let mcpReferenceMalformed = false;
  let mcpReferenceMalformedReason = null;
  if (govType === 'mcp_client') {
    if (isMcpNameFallbackMatch) {
      mcpServerReference = node.name;
      mcpReferenceMalformed = true;
      mcpReferenceMalformedReason = `Node type "${node.type}" is not a recognized MCP client type — matched only by name pattern, so its parameters could not be inspected`;
    } else {
      const extraction = extractMcpServerReference(node);
      mcpServerReference = extraction.reference;
      mcpReferenceMalformed = extraction.malformed;
      mcpReferenceMalformedReason = extraction.malformedReason;
    }
  }

  return {
    id: `${node.id || node.name}`,
    node_id: node.id || '',
    node_name: node.name,
    n8n_type: node.type,
    governance_type: govType,
    risk_factors: risks,
    // Redacted before it ever reaches storage/logs — the raw match never leaves scanForSecrets.
    parameters_json: redactedParameters,
    secret_findings: secretFindings,
    mcp_server_reference: mcpServerReference,
    mcp_reference_malformed: mcpReferenceMalformed,
    mcp_reference_malformed_reason: mcpReferenceMalformedReason,
    disabled: node.disabled || false,
    credentials: node.credentials || {},
  };
}

function buildDAG(nodes, connections) {
  // n8n connections structure: { NodeName: { main: [[{node, type, index}]] } }
  const edges = [];
  if (!connections || typeof connections !== 'object') return edges;
  for (const [sourceName, outputs] of Object.entries(connections)) {
    const outputArrays = outputs?.main || [];
    for (const outputGroup of outputArrays) {
      for (const conn of (outputGroup || [])) {
        edges.push({ source: sourceName, target: conn.node, type: 'main' });
      }
    }
  }
  return edges;
}

function extractCredentials(workflowDef) {
  const seen = new Set();
  const creds = [];
  for (const node of (workflowDef.nodes || [])) {
    for (const [type, ref] of Object.entries(node.credentials || {})) {
      const key = `${ref.id}:${type}`;
      if (!seen.has(key)) {
        seen.add(key);
        creds.push({ id: ref.id, name: ref.name || '', type });
      }
    }
  }
  return creds;
}

function detectPII(classifiedNodes) {
  const piiFields = new Set();
  const risks = [];

  for (const node of classifiedNodes) {
    const paramStr = JSON.stringify(node.parameters_json);
    for (const [piiType, pattern] of Object.entries(PII_PATTERNS)) {
      if (pattern.test(paramStr)) {
        piiFields.add(piiType);
        risks.push({
          pii_type: piiType,
          node_name: node.node_name,
          field_location: 'parameter',
          masked: /\*{3,}|redact|mask/i.test(paramStr),
          encrypted: /encrypt|cipher/i.test(paramStr),
        });
      }
    }
  }

  const hasExternalHttp = classifiedNodes.some(n => n.governance_type === 'http');
  return {
    hasPII: piiFields.size > 0,
    piiFields: [...piiFields],
    risks,
    exposedToExternal: piiFields.size > 0 && hasExternalHttp,
  };
}

// Aggregates the per-node secret_findings (already redacted/fingerprinted in
// classifyNode) into the same shape detectPII uses, for a consistent API surface.
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

// Collects MCP-client node references for cross-service resolution against
// mcp_governance.mcp_servers (done by the caller, not here — this stays a
// pure function with no I/O, same as detectPII/detectHardcodedSecrets).
function detectMcpReferences(classifiedNodes) {
  return classifiedNodes
    .filter(n => n.governance_type === 'mcp_client')
    .map(n => ({
      node_name: n.node_name,
      server_reference: n.mcp_server_reference,
      malformed: n.mcp_reference_malformed,
      malformed_reason: n.mcp_reference_malformed_reason,
    }));
}

function analyzeErrorHandling(workflowDef) {
  const nodes = workflowDef.nodes || [];
  const settings = workflowDef.settings || {};
  const hasErrorBranches = (workflowDef.connections
    ? Object.values(workflowDef.connections).some(c => c.error?.length > 0)
    : false);
  const hasTryCatch = nodes.some(n => {
    const code = String(n.parameters?.jsCode || n.parameters?.functionCode || '');
    return /try\s*\{/.test(code);
  });
  const retryNode = nodes.find(n => n.parameters?.retryOnFail || n.parameters?.maxTries);
  return {
    hasTryCatch,
    hasErrorBranches,
    hasRetryLogic: !!retryNode,
    retryConfiguration: retryNode ? {
      maxRetries: retryNode.parameters?.maxTries || 3,
      backoffType: retryNode.parameters?.waitBetweenTries > 0 ? 'fixed' : 'fixed',
      backoffBaseMs: (retryNode.parameters?.waitBetweenTries || 1) * 1000,
    } : null,
    saveDataOnError: settings.saveDataErrorExecution !== 'none',
  };
}

function extractExternalDeps(classifiedNodes, credentials) {
  const deps = new Set();
  for (const cred of credentials) deps.add(`credential:${cred.type}`);
  for (const node of classifiedNodes) {
    if (node.governance_type === 'http') {
      const url = String(node.parameters_json?.url || '');
      try {
        const { hostname } = new URL(url);
        deps.add(`http:${hostname}`);
      } catch {}
    }
    if (node.governance_type === 'ai_inference') deps.add(`ai:${node.n8n_type}`);
  }
  return [...deps];
}

function extract(workflowDef) {
  const nodes = workflowDef.nodes || [];
  const classifiedNodes = nodes.map(classifyNode);
  const dag = buildDAG(nodes, workflowDef.connections);
  const credentials = extractCredentials(workflowDef);
  const piiExposure = detectPII(classifiedNodes);
  const secretExposure = detectHardcodedSecrets(classifiedNodes);
  const mcpReferences = detectMcpReferences(classifiedNodes);
  const errorHandling = analyzeErrorHandling(workflowDef);
  const triggers = classifiedNodes.filter(n =>
    n.governance_type === 'webhook' || n.governance_type === 'schedule'
  );
  const externalDeps = extractExternalDeps(classifiedNodes, credentials);

  return {
    id: workflowDef.id,
    name: workflowDef.name,
    nodes: classifiedNodes,
    dag,
    credentials,
    triggers,
    piiExposure,
    secretExposure,
    mcpReferences,
    errorHandling,
    externalDeps,
    discoveredAt: new Date().toISOString(),
  };
}

export default { extract, classifyNode, detectPII, detectHardcodedSecrets, detectMcpReferences, buildDAG, NODE_TYPE_MAP, scanForSecrets };
