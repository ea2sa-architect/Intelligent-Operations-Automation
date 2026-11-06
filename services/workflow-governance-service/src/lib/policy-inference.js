// Infers governance policies from risk scores and pushes them to governance-service

const GOVERNANCE_URL = process.env.GOVERNANCE_SERVICE_URL || 'http://localhost:3300';

// AUTH-201 (extended) — governance-service now requires authentication;
// these calls carry no browser session, so they authenticate with the
// shared internal service key instead.
function serviceHeaders(extra = {}) {
  return { ...extra, 'X-Internal-Service-Key': process.env.INTERNAL_SERVICE_KEY || '' };
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unnamed';
}

// Fetch all existing policies once per inferPolicies call (cached in the closure)
async function loadExistingPolicies() {
  try {
    const res = await fetch(`${GOVERNANCE_URL}/policies`, { headers: serviceHeaders() });
    if (!res.ok) return [];
    const data = await res.json().catch(() => []);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function upsertPolicy(policy, existingByName) {
  const existing = existingByName.get(policy.name);
  try {
    if (existing) {
      // Update name, description, and metadata in-place
      const res = await fetch(`${GOVERNANCE_URL}/policies/${existing.id}`, {
        method: 'PUT',
        headers: serviceHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          name:          policy.name,
          description:   policy.description,
          metadata_json: policy.metadata_json,
        }),
      });
      if (!res.ok) {
        console.error(`[policy-inference] PUT ${existing.id} failed: ${await res.text()}`);
        return null;
      }
      return res.json();
    }

    const res = await fetch(`${GOVERNANCE_URL}/policies`, {
      method: 'POST',
      headers: serviceHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(policy),
    });
    if (!res.ok) {
      console.error(`[policy-inference] POST failed: ${await res.text()}`);
      return null;
    }
    return res.json();
  } catch (err) {
    console.error('[policy-inference] Failed to reach governance-service:', err.message);
    return null;
  }
}

function rateLimit(riskLevel) {
  return { CRITICAL: 10, HIGH: 30, MEDIUM: 100, LOW: 1000 }[riskLevel] ?? 100;
}

function concurrencyLimit(riskLevel) {
  return { CRITICAL: 1, HIGH: 3, MEDIUM: 5, LOW: 10 }[riskLevel] ?? 5;
}

function timeoutMs(riskLevel) {
  return { CRITICAL: 10000, HIGH: 30000, MEDIUM: 60000, LOW: 120000 }[riskLevel] ?? 60000;
}

function guardrailsPolicy(workflowId, workflowName, riskScore) {
  return {
    name: `guardrails-${slugify(workflowName)}`,
    description: `Operational guardrails — "${workflowName}" (${riskScore.risk_level}, score ${riskScore.risk_score})`,
    status: 'active',
    metadata_json: {
      source:        'workflow-governance-service',
      workflow_id:   workflowId,
      workflow_name: workflowName,
      policy_type:   'guardrail',
      inferred_from: { risk_score: riskScore.risk_score, risk_level: riskScore.risk_level },
      rules: [
        {
          id: 'rate-limit',
          name: 'Rate Limiting',
          condition: { dimension: 'requests_per_minute', operator: '>', value: rateLimit(riskScore.risk_level) },
          action: { type: 'block', target: 'webhook', rationale: 'Prevent abuse' },
          severity: 'critical',
        },
        {
          id: 'concurrency-limit',
          name: 'Max Concurrent Runs',
          condition: { dimension: 'concurrency', operator: '>', value: concurrencyLimit(riskScore.risk_level) },
          action: { type: 'block', target: 'execution', rationale: 'Prevent resource exhaustion' },
          severity: 'warning',
        },
        {
          id: 'execution-timeout',
          name: 'Execution Timeout',
          condition: { dimension: 'execution_duration_ms', operator: '>', value: timeoutMs(riskScore.risk_level) },
          action: { type: 'block', target: 'execution', rationale: 'Prevent hanging executions' },
          severity: 'warning',
        },
      ],
    },
  };
}

function hipaaPolicy(workflowId, workflowName, riskScore) {
  return {
    name: `hipaa-${slugify(workflowName)}`,
    description: `HIPAA mandatory controls — "${workflowName}" (risk score ${riskScore.risk_score} exceeds threshold 60)`,
    status: 'active',
    metadata_json: {
      source:               'workflow-governance-service',
      workflow_id:          workflowId,
      workflow_name:        workflowName,
      policy_type:          'mandatory_control',
      compliance_framework: 'HIPAA',
      inferred_from:        { risk_score: riskScore.risk_score, risk_level: riskScore.risk_level },
      rules: [
        {
          id: 'phi-redaction',
          name: 'PHI Redaction Required',
          condition: { dimension: 'pii_exposure', operator: '>', value: 0 },
          action: { type: 'require', target: 'pii_redaction', rationale: 'HIPAA §164.312 — PHI must be de-identified' },
          severity: 'critical',
        },
        {
          id: 'audit-trail',
          name: 'Audit Trail Required',
          condition: { dimension: 'always', operator: '==', value: true },
          action: { type: 'require', target: 'audit_log', rationale: 'HIPAA §164.312(b) — audit controls' },
          severity: 'critical',
        },
      ],
    },
  };
}

function gdprPolicy(workflowId, workflowName, riskScore) {
  return {
    name: `gdpr-pii-${slugify(workflowName)}`,
    description: `GDPR PII controls — "${workflowName}" (PII exposure score ${riskScore.dimensions.pii_exposure.score} exceeds threshold 70)`,
    status: 'active',
    metadata_json: {
      source:               'workflow-governance-service',
      workflow_id:          workflowId,
      workflow_name:        workflowName,
      policy_type:          'mandatory_control',
      compliance_framework: 'GDPR',
      inferred_from:        { risk_score: riskScore.risk_score, pii_score: riskScore.dimensions.pii_exposure.score },
      rules: [
        {
          id: 'pii-masking',
          name: 'PII Masking Required',
          condition: { dimension: 'pii_unmasked', operator: '>', value: 0 },
          action: { type: 'require', target: 'pii_masking', rationale: 'GDPR Art.25 — data minimisation' },
          severity: 'critical',
        },
        {
          id: 'data-residency',
          name: 'Data Residency Check',
          condition: { dimension: 'external_transfer', operator: '==', value: true },
          action: { type: 'require', target: 'residency_approval', rationale: 'GDPR Art.46 — international transfers' },
          severity: 'high',
        },
      ],
    },
  };
}

function aiGovernancePolicy(workflowId, workflowName, riskScore) {
  return {
    name: `ai-governance-${slugify(workflowName)}`,
    description: `AI safety controls — "${workflowName}" (AI provider risk score ${riskScore.dimensions.ai_provider_risk.score} exceeds threshold 40)`,
    status: 'active',
    metadata_json: {
      source:               'workflow-governance-service',
      workflow_id:          workflowId,
      workflow_name:        workflowName,
      policy_type:          'ai_governance',
      compliance_framework: 'AI_GOVERNANCE',
      inferred_from:        { risk_score: riskScore.risk_score, ai_score: riskScore.dimensions.ai_provider_risk.score },
      rules: [
        {
          id: 'model-pinning',
          name: 'Model Version Pinning',
          condition: { dimension: 'model_version_pinned', operator: '==', value: false },
          action: { type: 'require', target: 'model_specification', rationale: 'Ensure reproducibility' },
          severity: 'critical',
        },
        {
          id: 'token-limit',
          name: 'Max Tokens Per Call',
          condition: { dimension: 'tokens', operator: '>', value: 2000 },
          action: { type: 'block', target: 'ai_call', rationale: 'Prevent runaway LLM calls' },
          severity: 'warning',
        },
        {
          id: 'prompt-injection',
          name: 'Prompt Injection Prevention',
          condition: { dimension: 'user_input_in_prompt', operator: '==', value: true },
          action: { type: 'require', target: 'input_sanitization', rationale: 'Prevent prompt injection' },
          severity: 'critical',
        },
      ],
    },
  };
}

async function inferPolicies(workflowId, workflowName, riskScore) {
  const toUpsert = [];

  toUpsert.push(guardrailsPolicy(workflowId, workflowName, riskScore));

  if (riskScore.risk_score > 60) {
    toUpsert.push(hipaaPolicy(workflowId, workflowName, riskScore));
  }
  if ((riskScore.dimensions?.pii_exposure?.score || 0) > 70) {
    toUpsert.push(gdprPolicy(workflowId, workflowName, riskScore));
  }
  if ((riskScore.dimensions?.ai_provider_risk?.score || 0) > 40) {
    toUpsert.push(aiGovernancePolicy(workflowId, workflowName, riskScore));
  }

  // Load existing once, build name→policy map for O(1) lookup
  const existing = await loadExistingPolicies();
  const existingByName = new Map(existing.map(p => [p.name, p]));

  const results = await Promise.all(toUpsert.map(p => upsertPolicy(p, existingByName)));
  return results.filter(Boolean);
}

export default { inferPolicies };
