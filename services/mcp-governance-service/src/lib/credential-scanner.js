// Epic 5, Feature 5.3 — detects known credential-shaped strings in MCP
// configuration data (server registration fields, resource URI templates).
// Deliberately the same deterministic-pattern, redact-and-fingerprint
// approach as workflow-governance-service's metadata-extractor.js
// scanForSecrets — duplicated rather than imported because
// mcp-governance-service is a separate deployable with no shared package —
// but the six original patterns are copied verbatim for consistency.
//
// One MCP-specific addition: basic_auth_url. MCP resources commonly declare
// a URI template like postgres://user:pass@host/db — a credential shape
// n8n node parameters never have, so the workflow-side scanner never needed it.

import crypto from 'crypto';

const SECRET_PATTERNS = {
  openai_key:     /sk-[A-Za-z0-9]{20,}/g,
  anthropic_key:  /sk-ant-[A-Za-z0-9-]{20,}/g,
  aws_access_key: /AKIA[0-9A-Z]{16}/g,
  github_token:   /gh[pousr]_[A-Za-z0-9]{30,}/g,
  slack_token:    /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  bearer_token:   /Bearer\s+[A-Za-z0-9\-_.]{20,}/g,
  basic_auth_url: /[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/\s:@]+:[^/\s:@]+@/g,
};

function fingerprintSecret(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

// Keeps first/last 4 chars only — enough to eyeball "is this the right
// credential rotated or not" without ever exposing the usable secret.
function redactSecret(value) {
  return value.length <= 8 ? '****' : `${value.slice(0, 4)}****${value.slice(-4)}`;
}

// Epic 6, Feature 6.2 — compiles an administrator-supplied pattern string
// (stored as TEXT in mcp_governance.redaction_patterns) into a RegExp.
// Never lets a malformed pattern throw at scan time — an invalid pattern is
// simply excluded, same "fail closed on the finding, not on the whole scan"
// principle as redaction failure handling below.
function compilePattern(patternText) {
  try {
    return new RegExp(patternText, 'g');
  } catch {
    return null;
  }
}

// Scans a flat { fieldName: value } map for hardcoded credentials. Returns
// findings (redacted preview + fingerprint only — the raw match never
// leaves this function) and a redacted copy of the same fields, safe to
// persist. Values may be strings or JSON-serializable (e.g. dependencies_json).
// extraPatterns (Feature 6.2) merges administrator-configured patterns
// (loaded from mcp_governance.redaction_patterns by the caller) alongside
// the built-in SECRET_PATTERNS without any code change here.
function redactFields(fields, extraPatterns = {}) {
  const allPatterns = { ...SECRET_PATTERNS, ...extraPatterns };
  const redactedFields = {};
  const findings = [];

  for (const [fieldName, rawValue] of Object.entries(fields)) {
    if (rawValue == null) { redactedFields[fieldName] = rawValue; continue; }
    const isString = typeof rawValue === 'string';
    const raw = isString ? rawValue : JSON.stringify(rawValue);
    let redacted = raw;

    for (const [secretType, pattern] of Object.entries(allPatterns)) {
      for (const match of raw.match(pattern) || []) {
        findings.push({
          field_name: fieldName,
          secret_type: secretType,
          redacted_preview: redactSecret(match),
          fingerprint_sha256: fingerprintSecret(match),
        });
        redacted = redacted.split(match).join(redactSecret(match));
      }
    }

    redactedFields[fieldName] = isString ? redacted : JSON.parse(redacted);
  }

  return { redactedFields, findings };
}

// Epic 6, Feature 6.2 — "redaction failures handled without persisting
// unredacted payloads." Wraps redactFields for runtime telemetry payloads
// (shapes IOA doesn't control, unlike registration-time config fields) —
// on ANY failure, the raw payload is withheld entirely rather than falling
// back to persisting it unredacted.
function redactFieldsOrWithhold(fields, extraPatterns = {}) {
  try {
    return { ...redactFields(fields, extraPatterns), redactionFailed: false };
  } catch {
    const withheld = Object.fromEntries(Object.keys(fields).map(k => [k, '[REDACTION_FAILED - PAYLOAD_WITHHELD]']));
    return { redactedFields: withheld, findings: [], redactionFailed: true };
  }
}

export default { redactFields, redactFieldsOrWithhold, compilePattern, SECRET_PATTERNS };
