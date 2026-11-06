import { resolveWorkflow } from '../discover/n8n-workflow.js';
import { runCheckCore } from './run-check.js';
import { fetchAnomalies, fetchAttackPaths } from './run-assess.js';
import { runExecutionTier } from './execute.js';

// `ioa qa` — the full pipeline: everything `ioa assess` computes, plus the
// controlled execution tier (if an approved profile exists — otherwise a
// visible not_eligible/not_approved state, never a silent skip).
export async function runQa({ baseUrl, token, target }) {
  const { workflow, registered } = await resolveWorkflow({ baseUrl, token, target });
  const base = await runCheckCore({ baseUrl, token, workflow, registered });

  const [anomalies, attack_paths, execution] = await Promise.all([
    fetchAnomalies({ baseUrl, token, workflowId: workflow.id }),
    fetchAttackPaths({ baseUrl, token, mcpReferences: workflow.mcp_references }),
    runExecutionTier({ baseUrl, token, workflowId: workflow.id }),
  ]);

  return { ...base, anomalies, attack_paths, execution };
}
