import { apiGet, apiPost } from '../api-client.js';
import { resolveWorkflow } from '../discover/n8n-workflow.js';
import { computeCoverage, bucketBySeverity } from './coverage.js';

// evaluate (POST /violations/evaluate) → policy-bindings (policies +
// per-rule coverage) → open violations, against an ALREADY-resolved
// workflow. Split out from runCheckPipeline so deeper commands (assess,
// threat-model, qa) that also need the full resolved workflow object
// (e.g. its mcp_references, for the attack-path stage) can resolve once
// and reuse it here, instead of each stage re-resolving independently.
export async function runCheckCore({ baseUrl, token, workflow, registered }) {
  const entityType = 'workflow';
  const entityId = workflow.id;

  await apiPost(baseUrl, token, '/api/governance/violations/evaluate', { workflow_id: entityId });

  const bindings = await apiGet(baseUrl, token, `/api/governance/policy-bindings?entity_type=${entityType}&entity_id=${entityId}`);
  const openViolations = await apiGet(baseUrl, token, `/api/governance/violations?entity_type=${entityType}&entity_id=${entityId}&status=open`);

  return {
    target: { type: entityType, id: entityId, name: workflow.name },
    run_at: new Date().toISOString(),
    register: { status: registered },
    policy_coverage: computeCoverage(bindings),
    violations: { open: openViolations, by_severity: bucketBySeverity(openViolations) },
  };
}

// The shared engine behind `ioa policy-check` on its own: resolve (register/
// reconcile) → runCheckCore. register/reconcile is intentionally not a
// separate exported step or CLI command — it's just the first thing this
// does, per the confirmed design: developers never invoke it directly.
export async function runCheckPipeline({ baseUrl, token, target }) {
  const { workflow, registered } = await resolveWorkflow({ baseUrl, token, target });
  return runCheckCore({ baseUrl, token, workflow, registered });
}

// CI-friendly exit semantics shared by every Check-mode command: fail only
// on open critical/high violations. Medium/low findings are visible in the
// report but don't fail the gate — matches this platform's own severity
// tiering (governance.violations.severity) rather than inventing a new one.
export function exitCodeFor(result) {
  const { critical, high } = result.violations.by_severity;
  return (critical > 0 || high > 0) ? 1 : 0;
}
