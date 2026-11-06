// E7-S1.3 — fail-soft, same fetch-wrapper convention as every other
// cross-service client in this codebase (mirrors mcp-governance-service's
// escalation-client.js exactly): escalation-service being unreachable must
// not fail the PUT /:id completion it was called from.

const ESCALATION_URL = process.env.ESCALATION_SERVICE_URL || 'http://localhost:3303';

async function createIncident({ title, severity, contextJson }) {
  try {
    const res = await fetch(`${ESCALATION_URL}/incidents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Service-Key': process.env.INTERNAL_SERVICE_KEY || '',
      },
      body: JSON.stringify({ title, severity, context_json: contextJson ?? null }),
    });
    if (!res.ok) throw new Error(`escalation-service returned ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('[escalation-client] Failed to create incident:', err.message);
    return null;
  }
}

export default { createIncident };
