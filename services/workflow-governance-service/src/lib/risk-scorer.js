// 16-dimension weighted risk scoring engine (see WEIGHTS below)

// Bump whenever WEIGHTS or a score* function changes shape/behavior — persisted
// on every risk-score-history row so scoring-model versions are comparable.
// 2025.2: added governance_posture + ownership_gap, rebalanced weights to sum to 1.0
// (2025.1's 13 weights summed to 1.10 — harmless since totalScore has no upper
// clamp, but not worth compounding further as dimensions keep being added).
// 2025.3: added recoverability (Increment 3.1), rebalanced to keep the sum at 1.0.
// 2025.4: replaced audit_logging's static notification-node proxy with
// operational_visibility, which prefers real execution telemetry when available
// (Increment 3.2) — same weight, no rebalance needed.
export const SCORING_VERSION = '2025.4';

const WEIGHTS = {
  ai_provider_risk:       0.09,
  pii_exposure:           0.09,
  governance_tags:        0.09,
  governance_posture:     0.10,
  approval_nodes:         0.08,
  credential_scope:       0.08,
  retry_policy:           0.07,
  external_integrations:  0.07,
  autonomous_execution:   0.06,
  data_retention:         0.05,
  error_handling:         0.04,
  ownership_gap:          0.05,
  recoverability:         0.05,
  api_exposure:           0.03,
  model_injection_risk:   0.03,
  operational_visibility: 0.02,
};
// Weights sum to 1.00 across all 16 dimensions.

// Explicit governance tags applied by workflow owners carry high signal weight
const TAG_RISK = {
  'external-ai':         { score: 90, factor: 'Tagged external-ai — third-party model in use' },
  'pii':                 { score: 85, factor: 'Tagged pii — PII explicitly declared by owner' },
  'customer-data':       { score: 70, factor: 'Tagged customer-data — customer records in scope' },
  'shadow-ai':           { score: 100, factor: 'Tagged shadow-ai — ungoverned AI usage' },
  'financial':           { score: 75, factor: 'Tagged financial — financial data in scope' },
  'hipaa':               { score: 95, factor: 'Tagged hipaa — healthcare PHI in scope' },
  'gdpr':                { score: 80, factor: 'Tagged gdpr — GDPR jurisdiction applies' },
  'production':          { score: 40, factor: 'Tagged production — live environment, higher stakes' },
  'executive-reporting': { score: 30, factor: 'Tagged executive-reporting — output accuracy critical' },
  'credential':          { score: 65, factor: 'Tagged credential — credential handling workflow' },
};

function scoreGovernanceTags(tags = []) {
  const tagNames = tags.map(t => (typeof t === 'string' ? t : t?.name ?? '')).map(n => n.toLowerCase());
  const matched = [];
  const factors = [];
  let total = 0;

  for (const [tag, { score, factor }] of Object.entries(TAG_RISK)) {
    if (tagNames.includes(tag)) {
      matched.push(tag);
      factors.push(factor);
      total += score;
    }
  }

  if (matched.length === 0) return { score: 0, factors: ['No governance tags applied'] };

  // Multiple high-risk tags compound
  const score = Math.min(100, Math.round(total / matched.length + (matched.length - 1) * 5));
  return { score, factors };
}

const PROVIDER_SCORES = {
  openai:         85,
  anthropic:      65,
  mistral:        70,
  ollama:         25,
  huggingface:    40,
  internal:       10,
};

function extractProvider(nodeType) {
  const t = nodeType.toLowerCase();
  if (t.includes('openai') || t.includes('open-ai')) return 'openai';
  if (t.includes('anthropic')) return 'anthropic';
  if (t.includes('mistral')) return 'mistral';
  if (t.includes('ollama')) return 'ollama';
  if (t.includes('hugging')) return 'huggingface';
  return 'openai'; // assume external if unknown
}

function scoreAiProviderRisk(metadata) {
  const aiNodes = metadata.nodes.filter(n => n.governance_type === 'ai_inference');
  if (aiNodes.length === 0) return { score: 0, factors: ['No AI inference nodes'] };

  const factors = [];
  let total = 0;

  for (const node of aiNodes) {
    const provider = extractProvider(node.n8n_type);
    const base = PROVIDER_SCORES[provider] || 60;
    total += base;
    factors.push(`${node.node_name} uses ${provider} (base risk ${base})`);
  }
  let score = total / aiNodes.length;

  const hasRateLimit = aiNodes.some(n => n.parameters_json?.rateLimit);
  if (!hasRateLimit) { score += 10; factors.push('No rate limiting on AI calls'); }

  const hasOllama = aiNodes.some(n => n.n8n_type.toLowerCase().includes('ollama'));
  if (hasOllama) { score -= 15; factors.push('Uses local Ollama (lower external risk)'); }

  return { score: Math.min(100, Math.max(0, Math.round(score))), factors };
}

function scorePiiExposure(metadata) {
  const { piiExposure } = metadata;
  if (!piiExposure.hasPII) return { score: 0, factors: ['No PII detected'] };

  const PII_WEIGHTS = { ssn: 100, credit_card: 95, password: 90, api_key: 85, dob: 60, phone: 50, email: 40, address: 35 };
  const factors = [];
  let total = 0;

  for (const risk of piiExposure.risks) {
    let s = PII_WEIGHTS[risk.pii_type] || 50;
    if (risk.masked)     { s -= 35; }
    if (risk.encrypted)  { s -= 25; }
    total += s;
    factors.push(`${risk.pii_type} in ${risk.node_name}${risk.masked ? ' (masked)' : ' (unmasked)'}`);
  }
  let score = total / Math.max(1, piiExposure.risks.length);
  if (piiExposure.exposedToExternal) { score += 20; factors.push('PII exposed to external HTTP endpoints'); }

  return { score: Math.min(100, Math.max(0, Math.round(score))), factors };
}

function scoreApprovalNodes(metadata) {
  const approvalNodes = metadata.nodes.filter(n => n.governance_type === 'approval');
  const factors = [];
  if (approvalNodes.length === 0) {
    factors.push('No human approval nodes — fully automated');
    return { score: 80, factors };
  }
  const score = Math.max(10, 80 - approvalNodes.length * 20);
  factors.push(`${approvalNodes.length} approval node(s) present`);
  return { score, factors };
}

function scoreRetryPolicy(metadata) {
  const { errorHandling } = metadata;
  const factors = [];
  if (!errorHandling.hasRetryLogic) {
    factors.push('No retry logic configured');
    return { score: 65, factors };
  }
  let score = 25;
  const cfg = errorHandling.retryConfiguration;
  if (cfg?.maxRetries < 3)          { score += 20; factors.push(`Low retry count: ${cfg.maxRetries}`); }
  if (cfg?.backoffType !== 'exponential') { score += 10; factors.push('Fixed backoff (not exponential)'); }
  else                               { score -= 5;  factors.push('Exponential backoff configured'); }
  factors.push(`Retry logic present (${cfg?.maxRetries} attempts)`);
  return { score: Math.min(100, Math.max(0, score)), factors };
}

function scoreCredentialScope(metadata) {
  const creds = metadata.credentials;
  const factors = [];
  // Credential *references* (n8n's own credential store) are a weaker signal
  // than a literal secret embedded in a parameter — those are scored separately
  // below and can apply even when zero formal credentials are attached.
  const hardcodedSecrets = metadata.secretExposure?.risks?.length ?? 0;

  let score = 0;
  if (creds.length === 0) {
    score = 10;
    factors.push('No credentials used');
  } else {
    score = creds.length * 12;
    const types = new Set(creds.map(c => c.type));
    if (types.has('oAuth2Api'))  { score += 5;  factors.push('OAuth2 credentials present'); }
    if (types.has('httpBasicAuth')) { score += 20; factors.push('Basic auth credentials (high risk)'); }
    if (creds.length > 4)        { score += 15; factors.push(`High credential count: ${creds.length}`); }
    factors.push(`${creds.length} credential(s): ${[...types].join(', ')}`);
  }

  if (hardcodedSecrets > 0) {
    score += hardcodedSecrets * 25;
    factors.push(`${hardcodedSecrets} hardcoded secret(s) detected in node parameters — credential reference alone does not cover this`);
  }

  return { score: Math.min(100, Math.max(0, score)), factors };
}

function scoreDataRetention(metadata) {
  const { errorHandling } = metadata;
  const factors = [];
  let score = 20;
  if (errorHandling.saveDataOnError) { score += 30; factors.push('Execution data saved on error (potential PII retention)'); }
  if (!errorHandling.hasTryCatch && !errorHandling.hasErrorBranches) {
    score += 20; factors.push('No error data handling strategy');
  }
  if (score <= 20) factors.push('Minimal data retention risk');
  return { score: Math.min(100, Math.max(0, score)), factors };
}

function scoreExternalIntegrations(metadata) {
  const httpNodes = metadata.nodes.filter(n => n.governance_type === 'http');
  const storageNodes = metadata.nodes.filter(n => n.governance_type === 'storage');
  const factors = [];
  if (httpNodes.length === 0 && storageNodes.length === 0) {
    return { score: 5, factors: ['No external HTTP or storage nodes'] };
  }
  let score = httpNodes.length * 15 + storageNodes.length * 10;

  const unencrypted = httpNodes.filter(n => n.risk_factors.includes('unencrypted_http'));
  if (unencrypted.length) { score += 25; factors.push(`${unencrypted.length} unencrypted HTTP call(s)`); }

  const noAuth = httpNodes.filter(n => n.risk_factors.includes('no_auth_header'));
  if (noAuth.length) { score += 20; factors.push(`${noAuth.length} unauthenticated HTTP call(s)`); }

  factors.push(`${httpNodes.length} HTTP + ${storageNodes.length} storage nodes`);
  return { score: Math.min(100, Math.max(0, score)), factors };
}

function scoreAutonomousExecution(metadata) {
  const factors = [];
  const scheduleNodes = metadata.nodes.filter(n => n.governance_type === 'schedule');
  const approvalNodes = metadata.nodes.filter(n => n.governance_type === 'approval');
  const aiNodes = metadata.nodes.filter(n => n.governance_type === 'ai_inference');

  let score = 0;
  if (scheduleNodes.length > 0) { score += 40; factors.push(`${scheduleNodes.length} schedule trigger(s) — runs autonomously`); }
  if (aiNodes.length > 0 && approvalNodes.length === 0) {
    score += 30; factors.push('AI nodes with no human oversight');
  }
  if (scheduleNodes.length > 0 && aiNodes.length > 0 && approvalNodes.length === 0) {
    score += 20; factors.push('Scheduled autonomous AI execution — highest concern');
  }
  if (score === 0) factors.push('No autonomous execution concerns');
  return { score: Math.min(100, Math.max(0, score)), factors };
}

function scoreErrorHandling(metadata) {
  const { errorHandling } = metadata;
  const factors = [];
  let score = 80;
  if (errorHandling.hasTryCatch)     { score -= 25; factors.push('Try/catch in code nodes'); }
  if (errorHandling.hasErrorBranches){ score -= 25; factors.push('Error branch connections present'); }
  if (errorHandling.hasRetryLogic)   { score -= 15; factors.push('Retry logic configured'); }
  if (score >= 80)                   { factors.push('No error handling found'); }
  return { score: Math.min(100, Math.max(0, score)), factors };
}

function scoreApiExposure(metadata) {
  const webhookNodes = metadata.nodes.filter(n => n.governance_type === 'webhook');
  const factors = [];
  if (webhookNodes.length === 0) return { score: 5, factors: ['No webhook entry points'] };
  let score = webhookNodes.length * 20;
  factors.push(`${webhookNodes.length} webhook endpoint(s) exposed`);
  return { score: Math.min(100, Math.max(0, score)), factors };
}

function scoreModelInjectionRisk(metadata) {
  const factors = [];
  const aiNodes = metadata.nodes.filter(n => n.governance_type === 'ai_inference');
  const webhookNodes = metadata.nodes.filter(n => n.governance_type === 'webhook');
  if (aiNodes.length === 0) return { score: 0, factors: ['No AI nodes'] };

  let score = 0;
  if (webhookNodes.length > 0 && aiNodes.length > 0) {
    score = 70;
    factors.push('User input from webhook may reach AI prompts (injection risk)');
  }
  const noPromptGuard = aiNodes.some(n => n.risk_factors.includes('no_system_prompt'));
  if (noPromptGuard) { score += 20; factors.push('AI node has no system prompt guard'); }
  if (score === 0) factors.push('No direct webhook→AI path detected');
  return { score: Math.min(100, Math.max(0, score)), factors };
}

// Prefers real execution telemetry (from telemetry-service, via Increment 3.2's
// execution-event ingestion) over the static notification-node proxy. Falls
// back to the proxy when no telemetry pipeline is wired up yet for this
// workflow — evaluating observed behavior when it exists, static config otherwise.
function scoreOperationalVisibility(metadata, telemetry) {
  const factors = [];

  if (telemetry && telemetry.total_executions_7d > 0) {
    let score = 10;
    factors.push(`${telemetry.total_executions_7d} execution(s) observed in the last 7 days`);
    if (telemetry.failure_rate_7d > 0) {
      score += Math.min(60, telemetry.failure_rate_7d * 0.6);
      factors.push(`${telemetry.failure_rate_7d}% failure rate (7d)`);
    }
    if (!telemetry.last_success_at) { score += 20; factors.push('No successful execution on record'); }
    return { score: Math.min(100, Math.round(score)), factors };
  }

  if (telemetry && telemetry.total_executions_7d === 0) {
    factors.push('No executions observed in the last 7 days — workflow may be dormant or unmonitored');
    return { score: 70, factors };
  }

  // No telemetry pipeline wired up yet (n8n execution webhook not configured) —
  // fall back to the static proxy signal.
  const notifNodes = metadata.nodes.filter(n => n.governance_type === 'notification');
  if (notifNodes.length > 0) {
    factors.push(`${notifNodes.length} notification node(s) provide execution trail (no execution telemetry wired up yet)`);
    return { score: 40, factors };
  }
  factors.push('No execution telemetry and no notification/logging nodes — execution not observed');
  return { score: 80, factors };
}

// Shared by ownership_gap and governance_posture (Increment 2) for staleness checks.
function daysSince(dateStr) {
  if (!dateStr) return Infinity;
  return (Date.now() - new Date(dateStr).getTime()) / 86_400_000;
}

function scoreOwnershipGap(ownership = {}) {
  const { technical_owner, business_owner, ownership_verified_at } = ownership;
  const factors = [];
  let score = 0;
  if (!technical_owner) { score += 8; factors.push('No technical owner assigned'); }
  if (!business_owner)  { score += 5; factors.push('No business owner assigned'); }
  if (daysSince(ownership_verified_at) > 180) {
    score += 3;
    factors.push('Ownership not verified in 180+ days');
  }
  if (score === 0) factors.push('Ownership fully assigned and verified');
  return { score, factors };
}

// Scores *whether identified breaches are being managed*, not the underlying
// technical condition — that's already scored by pii_exposure, approval_nodes,
// etc. Double-counting the same finding in two dimensions would inflate risk
// artificially, so this only looks at violation status/severity/age.
function scoreGovernancePosture(violations = []) {
  const factors = [];
  let score = 0;

  if (violations.length === 0) {
    factors.push('No policies evaluated against this workflow');
    return { score: 5, factors };
  }

  const open          = violations.filter(v => v.status === 'open');
  const critical       = open.filter(v => v.severity === 'critical').length;
  const high           = open.filter(v => v.severity === 'high').length;
  const overdueAck     = violations.filter(v =>
    v.status === 'acknowledged' && !v.resolved_at && daysSince(v.detected_at) > 14
  ).length;

  if (critical) { score += critical * 20; factors.push(`${critical} open critical violation(s)`); }
  if (high)     { score += high * 10;     factors.push(`${high} open high violation(s)`); }
  if (overdueAck) { score += overdueAck * 5; factors.push(`${overdueAck} acknowledged violation(s) overdue`); }

  if (score === 0) factors.push('All known violations resolved');
  return { score: Math.min(100, score), factors };
}

// "Backup exists" and "restore tested" are not equivalent — credit is weighted
// toward the evidence that actually proves recoverability. Expired evidence
// doesn't count (an evidence_type's most recent row must still be unexpired).
function scoreRecoverability(evidence = []) {
  const verified = type => evidence.some(e =>
    e.evidence_type === type && e.status === 'verified' &&
    (!e.expires_at || new Date(e.expires_at) > new Date())
  );

  if (evidence.length === 0) {
    return { score: 60, factors: ['No recoverability evidence recorded'] };
  }

  let score = 60;
  const factors = [];
  if (verified('workflow_export_verified'))     { score -= 15; factors.push('Workflow export verified'); }
  if (verified('database_backup_verified'))     { score -= 15; factors.push('Database backup verified'); }
  if (verified('restore_test_passed'))          { score -= 20; factors.push('Restore test passed'); }
  if (verified('runbook_available'))            { score -= 10; factors.push('Runbook available'); }
  if (factors.length === 0) factors.push('Evidence recorded but nothing currently verified/unexpired');
  return { score: Math.max(0, score), factors };
}

function determineRiskLevel(score) {
  if (score < 30) return 'LOW';
  if (score < 60) return 'MEDIUM';
  if (score < 80) return 'HIGH';
  return 'CRITICAL';
}

// `context` carries cross-cutting inputs that don't come from the workflow
// definition itself: { ownership, violations, evidence, telemetry }.
function scoreWorkflow(metadata, tags = [], context = {}) {
  const dimensions = {
    ai_provider_risk:       scoreAiProviderRisk(metadata),
    pii_exposure:           scorePiiExposure(metadata),
    governance_tags:        scoreGovernanceTags(tags),
    governance_posture:     scoreGovernancePosture(context.violations),
    approval_nodes:         scoreApprovalNodes(metadata),
    retry_policy:           scoreRetryPolicy(metadata),
    credential_scope:       scoreCredentialScope(metadata),
    data_retention:         scoreDataRetention(metadata),
    external_integrations:  scoreExternalIntegrations(metadata),
    autonomous_execution:   scoreAutonomousExecution(metadata),
    error_handling:         scoreErrorHandling(metadata),
    api_exposure:           scoreApiExposure(metadata),
    model_injection_risk:   scoreModelInjectionRisk(metadata),
    operational_visibility: scoreOperationalVisibility(metadata, context.telemetry),
    ownership_gap:          scoreOwnershipGap(context.ownership),
    recoverability:         scoreRecoverability(context.evidence),
  };

  let totalScore = 0;
  for (const [dim, result] of Object.entries(dimensions)) {
    totalScore += WEIGHTS[dim] * result.score;
  }
  totalScore = Math.round(totalScore * 100) / 100;

  // Top 5 risk factors: from dimensions with highest scores
  const sortedDims = Object.entries(dimensions).sort((a, b) => b[1].score - a[1].score);
  const topFactors = sortedDims
    .flatMap(([, d]) => d.factors.map(f => ({ factor: f, score: d.score })))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(f => f.factor);

  return {
    workflow_id: metadata.id,
    risk_score: totalScore,
    risk_level: determineRiskLevel(totalScore),
    dimensions,
    top_risk_factors: topFactors,
    calculated_at: new Date().toISOString(),
  };
}

export default { scoreWorkflow, determineRiskLevel, WEIGHTS };
