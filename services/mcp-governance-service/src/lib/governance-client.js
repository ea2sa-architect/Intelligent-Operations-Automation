// EP-101-S5 — a confirmed credential finding must produce a CRITICAL
// violation automatically, not wait for someone to call
// POST /violations/evaluate by hand. governance-service already has the
// evalMcpCredentialExposure evaluator and FORCED_SEVERITY = 'critical' wired
// up (Epic 5, Feature 5.3) — this just triggers it at the moment a finding
// is persisted. Same fail-soft fetch-wrapper pattern as every other
// cross-service client in this codebase: governance-service being
// unreachable must not break a server/tool/prompt/resource write.

const GOVERNANCE_URL = process.env.GOVERNANCE_SERVICE_URL || 'http://localhost:3300';

function serviceHeaders(extra = {}) {
  return { ...extra, 'X-Internal-Service-Key': process.env.INTERNAL_SERVICE_KEY || '' };
}

async function evaluateServer(serverId) {
  try {
    await fetch(`${GOVERNANCE_URL}/violations/evaluate`, {
      method: 'POST',
      headers: serviceHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ server_id: serverId }),
    });
  } catch (err) {
    console.error('[governance-client] Failed to trigger violation evaluation:', err.message);
  }
}

// EP-103-S2/S3 — mirrors an approval/rejection decision into
// governance-service's platform-wide, append-only approval_decision_history,
// alongside this service's own local history table (mcp_server_status_history /
// mcp_tool_decision_history) which stays the operational/UI source for the
// per-asset detail view. Fails soft — governance-service being unreachable
// must not block the approval action itself; the local history row is
// still the authoritative record for this asset either way.
async function recordApprovalDecision({ assetType, assetId, decision, actor, role, supportingEvidence, expiration }) {
  try {
    await fetch(`${GOVERNANCE_URL}/approval-decisions`, {
      method: 'POST',
      headers: serviceHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        asset_type: assetType, asset_id: assetId, decision, actor, role,
        supporting_evidence: supportingEvidence ?? null, expiration: expiration ?? null,
      }),
    });
  } catch (err) {
    console.error('[governance-client] Failed to record approval decision:', err.message);
  }
}

// EP-202 — deliberately NOT the fail-soft pattern the rest of this file
// uses. This is the check for whether a critical/high-risk approval is
// allowed to be finalized by one actor at all — if governance-service is
// unreachable, silently falling through to a direct approval would mean an
// outage bypasses the multi-party approval requirement it exists to
// enforce. A 404 (no active chain for this risk tier) is a legitimate,
// expected outcome and resolves to null so the caller falls through to a
// normal single-actor approval; anything else (network failure, 5xx) throws
// and the caller's approval action fails closed instead of succeeding
// unchecked.
async function startApprovalChain({ riskTier, assetType, assetId, requestedBy, reason }) {
  const res = await fetch(`${GOVERNANCE_URL}/approval-chains/requests`, {
    method: 'POST',
    headers: serviceHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      risk_tier: riskTier, asset_type: assetType, asset_id: assetId,
      requested_by: requestedBy, reason: reason ?? null,
    }),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`governance-service approval-chains request failed: ${res.status}`);
  return res.json();
}

// EP-204-S8 — a tool invocation whose caller-supplied acting_for_user_id
// doesn't match the delegation record's actual initiating_user_id is the
// confused-deputy pattern itself: the agent is using one principal's
// delegated authority to service a request nominally attributed to
// another. Same fail-soft fire-and-forget pattern as everything else here.
async function reportAgentConfusedDeputy({ agentId, agentName, delegatedForUserId, actingForUserId }) {
  try {
    await fetch(`${GOVERNANCE_URL}/violations/agent-security-event`, {
      method: 'POST',
      headers: serviceHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        agent_id: agentId, agent_name: agentName, rule_type: 'agent_confused_deputy',
        message: `Agent acted using authority delegated by user ${delegatedForUserId}, but the request identified user ${actingForUserId} as the beneficiary`,
      }),
    });
  } catch (err) {
    console.error('[governance-client] Failed to report agent confused-deputy event:', err.message);
  }
}

export default { evaluateServer, recordApprovalDecision, startApprovalChain, reportAgentConfusedDeputy };
