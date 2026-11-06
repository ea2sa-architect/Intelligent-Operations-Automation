// EP-201-S12/S13 — calls governance-service's POST /enforce for a live
// observe/warn/enforce decision on a direct inference request, ahead of the
// caller actually going and hitting the model provider. See
// docs/enforcement-adapter-contract.md for the shared contract every
// adapter (this one, the Kong plugin, workflow-governance-service) follows.
//
// Fails CLOSED, not the fail-soft-to-empty pattern most cross-service
// clients in this codebase use — this IS the enforcement decision itself
// (same reasoning as workflow-governance-service/src/lib/enforcement-client.js).
// Silently treating a governance-service outage as "allow" would mean an
// enforce-mode policy protects nothing exactly when the platform is unhealthy.

const GOVERNANCE_URL = process.env.GOVERNANCE_SERVICE_URL || 'http://localhost:3300';

async function checkEnforcement({ modelId, dataClassification, correlationId }) {
  try {
    const res = await fetch(`${GOVERNANCE_URL}/enforce`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Service-Key': process.env.INTERNAL_SERVICE_KEY || '',
      },
      body: JSON.stringify({
        asset_type: 'ai_model', asset_id: modelId, correlation_id: correlationId ?? null,
        context: { dataClassification: dataClassification ?? null },
      }),
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
        asset_type: 'ai_model', asset_id: modelId, correlation_id: correlationId ?? null,
      },
    };
  }
}

export default { checkEnforcement };
