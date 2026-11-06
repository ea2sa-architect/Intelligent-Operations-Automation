// Fetches policy violations from governance-service for use as risk-scoring
// input. Same fetch-wrapper pattern as policy-inference.js: fail soft, never
// throw — a governance-service outage should degrade scoring, not break it.

const GOVERNANCE_URL = process.env.GOVERNANCE_SERVICE_URL || 'http://localhost:3300';

async function fetchViolations(workflowId) {
  try {
    // AUTH-201 (extended) — governance-service now requires authentication;
    // this call carries no browser session, so it authenticates with the
    // shared internal service key instead.
    const res = await fetch(`${GOVERNANCE_URL}/violations?workflow_id=${encodeURIComponent(workflowId)}`, {
      headers: { 'X-Internal-Service-Key': process.env.INTERNAL_SERVICE_KEY || '' },
    });
    if (!res.ok) return [];
    const data = await res.json().catch(() => []);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export default { fetchViolations };
