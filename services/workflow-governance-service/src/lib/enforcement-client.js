// EP-201-S7/S8 — calls governance-service's POST /enforce to get a live
// observe/warn/enforce decision for a workflow, ahead of n8n executing it.
//
// Deliberately NOT the fail-soft-to-empty pattern every other cross-service
// client in this codebase uses (see governance-posture-client.js,
// mcp-governance-client.js) — those degrade a read used as scoring input,
// where "assume nothing" is the safe failure. This IS the enforcement
// decision itself: silently treating a governance-service outage as "allow"
// would mean an enforce-mode policy protects nothing exactly when the
// platform is unhealthy. Fails closed instead, matching the deny-by-default
// posture already used for tool/server approval — with a distinct reason so
// an operator can tell "governance-service unreachable" apart from an actual
// policy block in n8n's error branch.

const GOVERNANCE_URL = process.env.GOVERNANCE_SERVICE_URL || 'http://localhost:3300';

async function checkEnforcement({ assetType, assetId, correlationId }) {
  try {
    const res = await fetch(`${GOVERNANCE_URL}/enforce`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Service-Key': process.env.INTERNAL_SERVICE_KEY || '',
      },
      body: JSON.stringify({ asset_type: assetType, asset_id: assetId, correlation_id: correlationId ?? null }),
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  } catch (err) {
    return {
      status: 403,
      body: {
        decision: 'block',
        reason: 'governance-service unreachable',
        detail: err.message,
        asset_type: assetType, asset_id: assetId, correlation_id: correlationId ?? null,
      },
    };
  }
}

export default { checkEnforcement };
