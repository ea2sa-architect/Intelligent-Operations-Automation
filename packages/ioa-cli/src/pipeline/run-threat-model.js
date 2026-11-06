import { resolveWorkflow } from '../discover/n8n-workflow.js';
import { runCheckCore } from './run-check.js';
import { fetchAnomalies, fetchAttackPaths } from './run-assess.js';
import { summarizeExposure } from './exposure-summary.js';

// `ioa threat-model` — the same underlying data `ioa assess` computes
// (violations/coverage, anomalies, attack-paths), reframed around
// reachability/blast-radius (what this workflow can reach, and what's
// exposed along the way) instead of a violations-first report. No new
// backend calls beyond what assess already makes, plus the workflow's
// already-computed exposure data (pii_exposure/secret_exposure/risk_factors)
// it wasn't previously surfacing.
export async function runThreatModel({ baseUrl, token, target }) {
  const { workflow, registered } = await resolveWorkflow({ baseUrl, token, target });
  const base = await runCheckCore({ baseUrl, token, workflow, registered });

  const [anomalies, attack_paths] = await Promise.all([
    fetchAnomalies({ baseUrl, token, workflowId: workflow.id }),
    fetchAttackPaths({ baseUrl, token, mcpReferences: workflow.mcp_references }),
  ]);

  return { ...base, anomalies, attack_paths, exposure: summarizeExposure(workflow) };
}
