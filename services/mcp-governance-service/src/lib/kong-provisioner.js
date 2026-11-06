// EP-201-S4 — topology A (see kong-plugins/ioa-mcp-enforcement/README.md):
// each MCP server that reaches 'approved' gets its own Kong service + route
// + ioa-mcp-enforcement plugin instance, provisioned here via the live
// Admin API against the shared, Postgres-backed Kong instance (confirmed
// DB-backed — PUT-by-name upsert and nested route/plugin endpoints verified
// directly against it). A never-reviewed server has no business receiving
// proxied traffic — same deny-by-default posture as everywhere else in this
// platform, which is why provisioning happens on approval, not registration.
//
// Same fail-soft fetch-wrapper convention as governance-client.js/
// mcp-governance-client.js: Kong being unreachable must not block the
// approval action itself. Logged loudly on failure regardless — silently
// means traffic isn't actually gated yet, which is worth an operator's
// attention even though it doesn't block the request.

const KONG_ADMIN_URL = process.env.KONG_ADMIN_URL || 'http://localhost:8001';
const GOVERNANCE_URL = process.env.GOVERNANCE_SERVICE_URL || 'http://governance-service:3300';
const PLUGIN_NAME = 'ioa-mcp-enforcement';

function serviceName(serverId) { return `mcp-server-${serverId}`; }
function routeName(serverId) { return `mcp-server-${serverId}-route`; }

async function ok(res, label) {
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${label} failed: ${res.status} ${body}`);
  }
  return res.json();
}

async function upsertService(serverId, endpoint) {
  const res = await fetch(`${KONG_ADMIN_URL}/services/${serviceName(serverId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: endpoint, enabled: true }),
  });
  return ok(res, 'Kong service upsert');
}

async function upsertRoute(serverId) {
  const res = await fetch(`${KONG_ADMIN_URL}/services/${serviceName(serverId)}/routes/${routeName(serverId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths: [`/mcp/${serverId}`], strip_path: true }),
  });
  return ok(res, 'Kong route upsert');
}

// Kong has no unique-by-name upsert for plugins — a route can't carry two
// instances of the same plugin (verified: a second POST 409s), so this
// looks up any existing ioa-mcp-enforcement instance on the route first and
// PATCHes it, only POSTing a new one when none exists.
async function upsertEnforcementPlugin(serverId) {
  const route = routeName(serverId);
  const config = {
    governance_url: GOVERNANCE_URL,
    internal_service_key: process.env.INTERNAL_SERVICE_KEY || '',
    asset_type: 'mcp_server',
    asset_id: serverId,
    fail_mode: 'closed',
  };

  const listRes = await fetch(`${KONG_ADMIN_URL}/routes/${route}/plugins?name=${PLUGIN_NAME}`);
  const { data: existing } = await ok(listRes, 'Kong plugin lookup');

  if (existing.length > 0) {
    const res = await fetch(`${KONG_ADMIN_URL}/plugins/${existing[0].id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config }),
    });
    return ok(res, 'Kong plugin update');
  }

  const res = await fetch(`${KONG_ADMIN_URL}/routes/${route}/plugins`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: PLUGIN_NAME, config }),
  });
  return ok(res, 'Kong plugin create');
}

async function provisionServer(server) {
  try {
    await upsertService(server.id, server.endpoint);
    await upsertRoute(server.id);
    await upsertEnforcementPlugin(server.id);
  } catch (err) {
    console.error('[kong-provisioner] Failed to provision Kong routing:', err.message);
  }
}

// Disables (not deletes) the Kong SERVICE backing this server — routes have
// no enabled flag in Kong 3.x (verified against the schema), but a disabled
// service makes Kong return 503 for any route pointing at it. Preserves the
// service/route/plugin records rather than deleting them, matching this
// platform's append-only-audit posture elsewhere (servers.js/tools.js's
// DELETE guards) — nothing about a server's gateway presence should quietly
// disappear. Re-approving later (provisionServer) re-enables it.
async function deprovisionServer(serverId) {
  try {
    const res = await fetch(`${KONG_ADMIN_URL}/services/${serviceName(serverId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    if (!res.ok && res.status !== 404) {
      const body = await res.text().catch(() => '');
      throw new Error(`Kong service disable failed: ${res.status} ${body}`);
    }
  } catch (err) {
    console.error('[kong-provisioner] Failed to deprovision Kong routing:', err.message);
  }
}

export default { provisionServer, deprovisionServer };
