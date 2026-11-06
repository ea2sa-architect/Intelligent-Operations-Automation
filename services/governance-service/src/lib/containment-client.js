// EP-203 — calls into the asset-owning service to actually mutate
// containment_state (that column lives on the asset's own table, in its own
// service's schema — governance-service only owns the audit log,
// containment_log). Deliberately NOT fail-soft, unlike most cross-service
// clients in this codebase: containment is the kill switch itself. If the
// callback fails, the action did not happen, and governance-service must
// not write a containment_log entry claiming otherwise — see routes/
// containment.js, which only logs after this resolves successfully.

const MCP_GOVERNANCE_URL = process.env.MCP_GOVERNANCE_SERVICE_URL || 'http://mcp-governance-service:3306';
const WORKFLOW_GOVERNANCE_URL = process.env.WORKFLOW_GOVERNANCE_SERVICE_URL || 'http://workflow-governance-service:3305';

const ASSET_PATHS = {
  mcp_server: id => `${MCP_GOVERNANCE_URL}/servers/${id}/containment`,
  mcp_tool:   id => `${MCP_GOVERNANCE_URL}/tools/${id}/containment`,
  workflow:   id => `${WORKFLOW_GOVERNANCE_URL}/workflows/${id}/containment`,
};

function serviceHeaders(extra = {}) {
  return { ...extra, 'X-Internal-Service-Key': process.env.INTERNAL_SERVICE_KEY || '' };
}

async function applyContainment(assetType, assetId, containmentState) {
  const buildUrl = ASSET_PATHS[assetType];
  if (!buildUrl) throw new Error(`Unsupported asset_type: ${assetType}`);

  const res = await fetch(buildUrl(assetId), {
    method: 'POST',
    headers: serviceHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ containment_state: containmentState }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Containment callback failed: ${res.status} ${body}`);
  }
  return res.json();
}

// EP-203-S5 — only mcp_tool has a definition-snapshot history to restore
// from today (mcp_tool_definition_history, from tool drift tracking). See
// routes/containment.js for why mcp_server/workflow aren't supported yet.
async function rollbackTool(toolId) {
  const res = await fetch(`${MCP_GOVERNANCE_URL}/tools/${toolId}/rollback`, {
    method: 'POST',
    headers: serviceHeaders({ 'Content-Type': 'application/json' }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Rollback callback failed: ${res.status} ${body}`);
  }
  return res.json();
}

export default { applyContainment, rollbackTool };
