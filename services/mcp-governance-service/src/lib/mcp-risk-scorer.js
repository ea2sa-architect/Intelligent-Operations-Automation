// 8-dimension weighted risk scoring engine for MCP servers — same {score,
// factors} shape and weighted-sum approach as workflow-governance-service's
// risk-scorer.js, but deliberately a separate scorer: an MCP server's risk
// and a workflow's risk are different units and shouldn't be blended into
// one number (per the source document's explicit instruction).

export const SCORING_VERSION = '2025.1';

const WEIGHTS = {
  mcp_server_trust:           0.20,
  mcp_tool_privilege:         0.18,
  mcp_authorization_posture:  0.16,
  mcp_tool_integrity:         0.12,
  mcp_context_injection_risk: 0.12,
  mcp_approval_controls:      0.10,
  mcp_runtime_visibility:     0.06,
  mcp_data_boundary:          0.06,
};
// Weights sum to 1.00 across all 8 dimensions.

function daysSince(dateStr) {
  if (!dateStr) return Infinity;
  return (Date.now() - new Date(dateStr).getTime()) / 86_400_000;
}

function scoreServerTrust(server) {
  let score = 0;
  const factors = [];

  if (server.status === 'pending_review')  { score += 30; factors.push('Server still pending review'); }
  else if (server.status === 'rejected')   { score += 90; factors.push('Server was rejected'); }
  else if (server.status === 'retired')    { score += 70; factors.push('Server is retired but still referenced'); }

  if (!server.trusted_publisher) { score += 20; factors.push('Publisher not marked trusted'); }
  if (!server.technical_owner)   { score += 15; factors.push('No technical owner assigned'); }
  if (!server.business_owner)    { score += 10; factors.push('No business owner assigned'); }
  if (!server.integrity_info)    { score += 10; factors.push('No deployment integrity/signing info recorded'); }
  if (daysSince(server.review_date) > 180) { score += 10; factors.push('Not reviewed in 180+ days'); }

  if (score === 0) factors.push('Server fully trusted: approved, owned, and reviewed');
  return { score: Math.min(100, score), factors };
}

function scoreToolPrivilege(tools) {
  if (tools.length === 0) return { score: 10, factors: ['No tools registered for this server'] };

  const factors = [];
  const critical    = tools.filter(t => t.classification === 'T4').length;
  const high        = tools.filter(t => t.classification === 'T3').length;
  const destructive = tools.filter(t => t.destructive).length;
  const write       = tools.filter(t => t.behavior === 'write').length;

  let score = (critical * 25) + (high * 15) + (destructive * 10) + (write * 5);
  if (critical)    factors.push(`${critical} T4 (privileged/destructive) tool(s)`);
  if (high)        factors.push(`${high} T3 (sensitive/consequential) tool(s)`);
  if (destructive) factors.push(`${destructive} destructive-capable tool(s)`);
  if (write)       factors.push(`${write} write-capable tool(s)`);
  if (score === 0) factors.push('All tools are low-privilege, read-only');

  return { score: Math.min(100, score), factors };
}

function scoreAuthorizationPosture(authorizations) {
  if (authorizations.length === 0) return { score: 60, factors: ['No authorization posture recorded'] };

  let score = 0;
  const factors = [];
  for (const auth of authorizations) {
    if (auth.token_passthrough_detected)      { score += 60; factors.push('Token passthrough detected'); }
    if (!auth.oauth_audience)                  { score += 20; factors.push('No audience restriction configured'); }
    if (!auth.token_expiration_seconds)        { score += 10; factors.push('No token expiration configured (long-lived credential)'); }
    if (auth.downstream_credential_exchange)   { score += 15; factors.push('Downstream credential exchange in use'); }
  }
  if (score === 0) factors.push('Authorization scoped, audience-restricted, and time-limited');

  return { score: Math.min(100, score), factors };
}

function scoreToolIntegrity(tools) {
  if (tools.length === 0) return { score: 10, factors: ['No tools to assess'] };

  const factors = [];
  const noHash    = tools.filter(t => !t.definition_hash).length;
  const noVersion = tools.filter(t => !t.version).length;

  let score = 0;
  if (noHash > 0)    { score += Math.min(50, noHash * 10);    factors.push(`${noHash} tool(s) with no definition hash on record`); }
  if (noVersion > 0) { score += Math.min(30, noVersion * 5);  factors.push(`${noVersion} tool(s) with no pinned version`); }
  if (score === 0) factors.push('All tool definitions hashed and version-pinned');

  return { score: Math.min(100, score), factors };
}

function scorePromptInjectionRisk(prompts) {
  if (prompts.length === 0) return { score: 5, factors: ['No server-supplied prompts'] };

  let score = 0;
  const factors = [];
  const withInstructions = prompts.filter(p => p.embedded_instructions).length;
  const withToolRefs      = prompts.filter(p => p.tool_references?.length > 0).length;
  const unapproved        = prompts.filter(p => p.approval_status !== 'allowed').length;

  if (withInstructions) { score += withInstructions * 15; factors.push(`${withInstructions} prompt(s) carry embedded instructions`); }
  if (withToolRefs)     { score += withToolRefs * 20;     factors.push(`${withToolRefs} prompt(s) reference tools directly (cross-tool influence risk)`); }
  if (unapproved)       { score += unapproved * 10;       factors.push(`${unapproved} prompt(s) not yet approved`); }
  if (score === 0) factors.push('No injection-risk indicators in server prompts');

  return { score: Math.min(100, score), factors };
}

function scoreApprovalControls(tools) {
  const highPrivilege = tools.filter(t => t.classification === 'T3' || t.classification === 'T4');
  if (highPrivilege.length === 0) return { score: 5, factors: ['No high-privilege tools requiring approval controls'] };

  const factors = [];
  const unclassified   = tools.filter(t => !t.classification).length;
  const pendingHighPriv = highPrivilege.filter(t => t.approval_status === 'pending').length;

  let score = 0;
  if (unclassified > 0) { score += Math.min(40, unclassified * 10); factors.push(`${unclassified} tool(s) have no classification assigned`); }
  if (pendingHighPriv > 0) {
    score += pendingHighPriv * 15;
    factors.push(`${pendingHighPriv} high-privilege tool(s) still pending approval`);
  } else {
    factors.push(`${highPrivilege.length} high-privilege tool(s), all explicitly reviewed`);
  }

  return { score: Math.min(100, score), factors };
}

// Epic 6 (runtime telemetry) isn't built yet — this always degrades to "no
// visibility observed" until invocation telemetry exists, same principle as
// workflow risk-scorer's operational_visibility before its telemetry existed.
// Shaped to accept a telemetry input now so nothing needs to change here once
// Epic 6 lands — callers just start passing real data instead of null.
function scoreRuntimeVisibility(telemetry) {
  if (!telemetry || telemetry.total_invocations_7d == null) {
    return { score: 70, factors: ['No invocation telemetry available yet — runtime behavior unobserved'] };
  }
  if (telemetry.total_invocations_7d === 0) {
    return { score: 60, factors: ['No invocations observed in the last 7 days — may be dormant or unmonitored'] };
  }
  let score = 10;
  const factors = [`${telemetry.total_invocations_7d} invocation(s) observed in the last 7 days`];
  if (telemetry.failure_rate_7d > 0) {
    score += Math.min(60, telemetry.failure_rate_7d * 0.6);
    factors.push(`${telemetry.failure_rate_7d}% failure rate (7d)`);
  }
  return { score: Math.min(100, Math.round(score)), factors };
}

function scoreDataBoundary(resources) {
  if (resources.length === 0) return { score: 10, factors: ['No governed resources declared'] };

  let score = 0;
  const factors = [];
  const sensitive          = resources.filter(r => r.sensitivity === 'confidential' || r.sensitivity === 'restricted');
  const noTenantBoundary   = resources.filter(r => !r.tenant_boundary).length;
  const noRetention        = resources.filter(r => !r.retention_requirements).length;

  if (sensitive.length)  { score += sensitive.length * 20;         factors.push(`${sensitive.length} sensitive/restricted resource(s)`); }
  if (noTenantBoundary)  { score += Math.min(30, noTenantBoundary * 10); factors.push(`${noTenantBoundary} resource(s) with no tenant boundary defined`); }
  if (noRetention)       { score += Math.min(20, noRetention * 5);       factors.push(`${noRetention} resource(s) with no retention policy`); }
  if (score === 0) factors.push('All resources scoped, tenant-bounded, and retention-governed');

  return { score: Math.min(100, score), factors };
}

function determineRiskLevel(score) {
  if (score < 30) return 'LOW';
  if (score < 60) return 'MEDIUM';
  if (score < 80) return 'HIGH';
  return 'CRITICAL';
}

function scoreServer({ server, tools = [], resources = [], prompts = [], authorizations = [], telemetry = null }) {
  const dimensions = {
    mcp_server_trust:           scoreServerTrust(server),
    mcp_tool_privilege:         scoreToolPrivilege(tools),
    mcp_authorization_posture:  scoreAuthorizationPosture(authorizations),
    mcp_tool_integrity:         scoreToolIntegrity(tools),
    mcp_context_injection_risk: scorePromptInjectionRisk(prompts),
    mcp_approval_controls:      scoreApprovalControls(tools),
    mcp_runtime_visibility:     scoreRuntimeVisibility(telemetry),
    mcp_data_boundary:          scoreDataBoundary(resources),
  };

  let totalScore = 0;
  for (const [dim, result] of Object.entries(dimensions)) {
    totalScore += WEIGHTS[dim] * result.score;
  }
  totalScore = Math.round(totalScore * 100) / 100;

  const sortedDims = Object.entries(dimensions).sort((a, b) => b[1].score - a[1].score);
  const topFactors = sortedDims
    .flatMap(([, d]) => d.factors.map(f => ({ factor: f, score: d.score })))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(f => f.factor);

  return {
    server_id: server.id,
    risk_score: totalScore,
    risk_level: determineRiskLevel(totalScore),
    dimensions,
    top_risk_factors: topFactors,
    scoring_version: SCORING_VERSION,
    calculated_at: new Date().toISOString(),
  };
}

export default { scoreServer, determineRiskLevel, WEIGHTS };
