// Fetches the execution-summary (last success/failure, 7-day failure rate) for
// a workflow from telemetry-service, for use as risk-scoring input. Same
// fail-soft fetch-wrapper pattern as governance-posture-client.js.

const TELEMETRY_URL = process.env.TELEMETRY_SERVICE_URL || 'http://localhost:3304';

// AUTH-201 (extended) — telemetry-service now requires authentication on
// every route; these calls carry no browser session, so they authenticate
// with the shared internal service key instead.
// EP-102-S3 — also forwards x-correlation-id when the caller has one, so a
// workflow execution and whatever it triggers downstream (an MCP tool
// invocation, for instance) land in the same correlation chain in
// telemetry-service rather than each minting its own.
function serviceHeaders(extra = {}, correlationId) {
  return {
    ...extra,
    'X-Internal-Service-Key': process.env.INTERNAL_SERVICE_KEY || '',
    ...(correlationId ? { 'x-correlation-id': correlationId } : {}),
  };
}

async function fetchExecutionSummary(workflowId) {
  try {
    const res = await fetch(`${TELEMETRY_URL}/metrics/workflows/${encodeURIComponent(workflowId)}/execution-summary`, { headers: serviceHeaders() });
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch {
    return null;
  }
}

// Records one execution event (start/success/failure) into telemetry.metrics.
// correlationId (EP-102-S3) is the current request's chain id — the /workflows/:id/execution-event
// route passes req.correlationId, which is either the id n8n forwarded on
// its callback or one freshly minted for this webhook by the correlationId
// middleware. Threaded through as both the x-correlation-id request header
// and the metric's own correlation_id field, so it lands in telemetry's
// first-class column regardless of which one telemetry-service ends up using.
async function recordExecutionEvent(workflowId, { status, duration_ms, correlationId }) {
  try {
    await fetch(`${TELEMETRY_URL}/metrics`, {
      method: 'POST',
      headers: serviceHeaders({ 'Content-Type': 'application/json' }, correlationId),
      body: JSON.stringify({
        service_name: `workflow:${workflowId}`,
        metric_name: 'execution_status',
        value: status === 'success' ? 1 : 0,
        correlation_id: correlationId,
        labels_json: { workflow_id: workflowId, status, duration_ms: duration_ms ?? null },
      }),
    });
  } catch (err) {
    console.error('[telemetry-client] Failed to record execution event:', err.message);
  }
}

export default { fetchExecutionSummary, recordExecutionEvent };
