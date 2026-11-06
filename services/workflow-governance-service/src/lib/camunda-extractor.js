// Camunda BPMN metadata extractor.
// Produces the same metadata shape as metadata-extractor.js / make-extractor.js
// so that risk-scorer.js works unchanged.

import { parseBpmn } from './bpmn-parser.js';

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

function detectPII(nodes, xml) {
  const seen  = new Set();
  const risks = [];

  // Check both node names and the raw XML for PII field references
  for (const node of nodes) {
    const haystack = `${node.node_name ?? ''} ${JSON.stringify(node.parameters_json)}`;
    for (const [piiType, pattern] of Object.entries(PII_PATTERNS)) {
      const key = `${node.node_id}:${piiType}`;
      if (pattern.test(haystack) && !seen.has(key)) {
        seen.add(key);
        risks.push({
          pii_type:       piiType,
          node_name:      node.node_name,
          field_location: 'element-name',
          masked:         false,
          encrypted:      /encrypt|cipher/i.test(haystack),
        });
      }
    }
  }

  // Also scan zeebe:input/output mappings in raw XML for PII field names
  const inputRe = /zeebe:input\b[^/]*source="=([^"]+)"/g;
  let m;
  while ((m = inputRe.exec(xml)) !== null) {
    const expr = m[1];
    for (const [piiType, pattern] of Object.entries(PII_PATTERNS)) {
      if (pattern.test(expr) && !seen.has(`io:${piiType}`)) {
        seen.add(`io:${piiType}`);
        risks.push({
          pii_type:       piiType,
          node_name:      'I/O mapping',
          field_location: `expression: ${expr}`,
          masked:         false,
          encrypted:      false,
        });
      }
    }
  }

  const hasExternalHttp = nodes.some(n => n.governance_type === 'http');
  return {
    hasPII:            risks.length > 0,
    piiFields:         [...new Set(risks.map(r => r.pii_type))],
    risks,
    exposedToExternal: risks.length > 0 && hasExternalHttp,
  };
}

function analyzeErrorHandling(xml) {
  const hasBoundaryError = /errorEventDefinition/.test(xml);
  const hasCompensation  = /compensateEventDefinition/.test(xml);
  const hasRetries       = /\bretries\s*=\s*"[1-9]/.test(xml);

  return {
    hasTryCatch:        hasBoundaryError,
    hasErrorBranches:   hasBoundaryError,
    hasRetryLogic:      hasRetries,
    retryConfiguration: hasRetries
      ? { maxRetries: 3, backoffType: 'exponential', backoffBaseMs: 1000 }
      : null,
    saveDataOnError: hasCompensation,
  };
}

function extractExternalDeps(nodes) {
  const deps = new Set();
  for (const node of nodes) {
    if (node.governance_type === 'ai_inference') {
      const provider = (node.n8n_type ?? '').split(':')[1] ?? 'camunda-ai';
      deps.add(`ai:${provider}`);
    }
    if (node.governance_type === 'database') deps.add(`db:${node.n8n_type}`);
    if (node.governance_type === 'http')     deps.add('http:external');
  }
  return [...deps];
}

/**
 * @param {object} process - { id, name, bpmnXml, ... }
 */
function extract(process) {
  const xml = process.bpmnXml ?? '';
  const { nodes, processName } = parseBpmn(xml);

  const piiExposure   = detectPII(nodes, xml);
  const errorHandling = analyzeErrorHandling(xml);
  const triggers      = nodes.filter(n =>
    n.governance_type === 'webhook' || n.governance_type === 'schedule'
  );
  const externalDeps = extractExternalDeps(nodes);

  return {
    id:           process.id ?? processName,
    name:         process.name ?? processName,
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
