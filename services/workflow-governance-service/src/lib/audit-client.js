// Fire-and-forget audit logging for workflow-governance-service's own
// destructive admin actions — same pattern as auth-service's audit-client.js
// (EP-310-S5). First use: DELETE /workflows (clearing stale imported
// workflow data), which is exactly the kind of bulk action this platform's
// own audit trail should capture, not just log to stdout.
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

export function logWorkflowsCleared({ actorId, count }) {
  return emit({
    event_type: 'workflow.bulk_delete',
    actor_id: actorId || 'unknown',
    actor_type: 'user',
    resource_type: 'workflow',
    resource_id: 'all',
    action: 'delete',
    outcome: 'success',
    metadata_json: { count },
  });
}

export function logWorkflowsRestored({ actorId, exportedAt, counts }) {
  return emit({
    event_type: 'workflow.bulk_restore',
    actor_id: actorId || 'unknown',
    actor_type: 'user',
    resource_type: 'workflow',
    resource_id: 'all',
    action: 'restore',
    outcome: 'success',
    metadata_json: { source_exported_at: exportedAt, counts },
  });
}
