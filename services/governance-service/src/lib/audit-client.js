// Fire-and-forget audit logging for governance-service's own bulk policy
// actions — same pattern as workflow-governance-service's audit-client.js
// (EP-310-S5). First use: policy bundle export/import, which move whole
// policies in and out of the platform and belong in its own audit trail.
const AUDIT_URL = process.env.AUDIT_SERVICE_URL || 'http://audit-service:3302';

async function emit(event) {
  try {
    await fetch(`${AUDIT_URL}/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Service-Key': process.env.INTERNAL_SERVICE_KEY || '',
      },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    console.error('[audit-client] failed to emit event:', err.message);
  }
}

// outcome is 'success' or 'failure' only: a bundle import is one transaction,
// so there is no partial result to report.
export function logPolicyBundleExport({ actorId, outcome, policyNames, reason }) {
  return emit({
    event_type: 'policy.bundle_export',
    actor_id: actorId || 'unknown',
    actor_type: 'user',
    resource_type: 'policy',
    resource_id: 'bundle',
    action: 'export',
    outcome,
    metadata_json: { count: policyNames?.length ?? 0, policies: policyNames ?? [], ...(reason && { reason }) },
  });
}

export function logPolicyBundleImport({ actorId, outcome, onConflict, results, reason }) {
  return emit({
    event_type: 'policy.bundle_import',
    actor_id: actorId || 'unknown',
    actor_type: 'user',
    resource_type: 'policy',
    resource_id: 'bundle',
    action: 'import',
    outcome,
    metadata_json: { on_conflict: onConflict, count: results?.length ?? 0, policies: results ?? [], ...(reason && { reason }) },
  });
}
