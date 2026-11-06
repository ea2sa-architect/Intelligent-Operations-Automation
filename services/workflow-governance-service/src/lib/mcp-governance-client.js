// Resolves a workflow's declared MCP server reference against
// mcp_governance.mcp_servers via HTTP — same fail-soft fetch-wrapper pattern
// as governance-posture-client.js and telemetry-client.js. An unreachable
// mcp-governance-service must not break workflow scoring; it just means the
// reference can't be resolved this run (treated as unregistered, not silently skipped).

const MCP_GOVERNANCE_URL = process.env.MCP_GOVERNANCE_SERVICE_URL || 'http://localhost:3306';

// AUTH-201 (extended) — mcp-governance-service now requires authentication;
// these calls carry no browser session, so they authenticate with the
// shared internal service key instead.
function serviceHeaders() {
  return { 'X-Internal-Service-Key': process.env.INTERNAL_SERVICE_KEY || '' };
}

async function resolveServerReference(ref) {
  if (!ref) return { registered: false };
  try {
    const res = await fetch(`${MCP_GOVERNANCE_URL}/servers/resolve?ref=${encodeURIComponent(ref)}`, { headers: serviceHeaders() });
    if (res.status === 404) return { registered: false };
    // Epic 2, Feature 2.2 — ambiguous matches (409) are a distinct outcome
    // from both registered and unregistered; surface the candidate list
    // rather than collapsing it into a plain "not registered".
    if (res.status === 409) {
      const body = await res.json().catch(() => ({}));
      return { registered: false, ambiguous: true, candidates: body.candidates ?? [] };
    }
    if (!res.ok) return { registered: false };
    return await res.json().catch(() => ({ registered: false }));
  } catch {
    return { registered: false };
  }
}

// EP-306-S6 — reports an unregistered MCP reference found in a workflow as
// a discovery candidate, reusing the same POST /servers/discovery-import
// endpoint the discovery-agent CLI calls (EP-306-S4). Authenticates with
// INTERNAL_SERVICE_KEY like every other call in this file — no API-key
// exchange needed, this is a direct service-to-service call, not an
// external client. Fire-and-forget: a failed report must not break workflow
// scoring, same reasoning as resolveServerReference's own fail-soft catch.
async function reportDiscovery({ name, sourcePath }) {
  if (!name) return;
  try {
    await fetch(`${MCP_GOVERNANCE_URL}/servers/discovery-import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...serviceHeaders() },
      body: JSON.stringify({
        discovered: [{ name, url: name, source: 'n8n_workflow', source_path: sourcePath, env_hints: [] }],
      }),
    });
  } catch {
    // best-effort — see file header comment
  }
}

// Fetches full server detail (owner, hosting environment, tools, authorizations)
// for trust-ceiling derivation. Fails soft to null — an unreachable
// mcp-governance-service means this server's ceiling conditions can't be
// evaluated this run, not that workflow scoring should break.
async function fetchServerDetail(serverId) {
  if (!serverId) return null;
  try {
    const res = await fetch(`${MCP_GOVERNANCE_URL}/servers/${encodeURIComponent(serverId)}`, { headers: serviceHeaders() });
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch {
    return null;
  }
}

export default { resolveServerReference, fetchServerDetail, reportDiscovery };
