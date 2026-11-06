import { apiGet } from '../api-client.js';
import { resolveWorkflow } from '../discover/n8n-workflow.js';
import { runCheckCore } from './run-check.js';
import { classifyBaselineState } from './anomaly-state.js';

const is404 = err => /\(404\)/.test(err.message);

// Exported so run-threat-model.js can reuse the exact same fetch/state
// logic instead of duplicating it — threat-model is the same underlying
// data, reframed by a different formatter, not a separate pipeline.
export async function fetchAnomalies({ baseUrl, token, workflowId }) {
  const baseline = await apiGet(baseUrl, token, `/api/workflow-governance/anomaly/baselines/${workflowId}`)
    .catch(err => { if (is404(err)) return null; throw err; });

  const status = classifyBaselineState(baseline);
  if (!baseline) return { status, alerts: [] };

  const alerts = await apiGet(baseUrl, token, `/api/workflow-governance/anomaly/alerts?workflow_id=${workflowId}&status=open`);
  return { status, baseline_computed_at: baseline.computed_at, alerts };
}

// Each referenced MCP server is looked up independently, never offered a
// silent skip on 404 — "not computed yet" is a distinct, visible state
// (matches the no_baseline treatment above), not the same as "no risk."
export async function fetchAttackPaths({ baseUrl, token, mcpReferences }) {
  const serverIds = [...new Set((mcpReferences ?? []).map(r => r.mcp_server_id).filter(Boolean))];
  return Promise.all(serverIds.map(async serverId => {
    const path = await apiGet(baseUrl, token, `/api/workflow-governance/attack-paths/${serverId}`)
      .catch(err => { if (is404(err)) return null; throw err; });
    return path ?? { mcp_server_id: serverId, status: 'not_computed' };
  }));
}

// `ioa assess` — everything `ioa policy-check` reports, plus a full
// read-only picture: behavioral anomalies (if a baseline exists) and
// attack-path findings for every MCP server this workflow references.
// Still no execution tier, no remediation-apply — the "what does IOA
// already know" snapshot.
export async function runAssess({ baseUrl, token, target }) {
  const { workflow, registered } = await resolveWorkflow({ baseUrl, token, target });
  const base = await runCheckCore({ baseUrl, token, workflow, registered });

  const [anomalies, attack_paths] = await Promise.all([
    fetchAnomalies({ baseUrl, token, workflowId: workflow.id }),
    fetchAttackPaths({ baseUrl, token, mcpReferences: workflow.mcp_references }),
  ]);

  return { ...base, anomalies, attack_paths };
}
