// Epic 6, Feature 6.1 — records MCP tool invocation telemetry into
// telemetry-service, reusing its existing generic metrics-ingestion
// pattern (service_name/metric_name/value/labels_json) exactly the way
// workflow-governance-service's telemetry-client.js records execution
// events — no new hypertable needed. Same fail-soft fetch-wrapper pattern
// as every other cross-service client in this codebase: an unreachable
// telemetry-service must not break a tool invocation.

const TELEMETRY_URL = process.env.TELEMETRY_SERVICE_URL || 'http://localhost:3304';

// AUTH-201 (extended) — telemetry-service now requires authentication on
// every route; this call carries no browser session, so it authenticates
// with the shared internal service key instead.
// EP-102-S3 — forwards x-correlation-id too, consistent with the
// platform-wide standard, though the explicit correlation_id field in the
// POST /metrics body below is what actually lands in telemetry.metrics'
// first-class column.
function serviceHeaders(extra = {}, correlationId) {
  return {
    ...extra,
    'X-Internal-Service-Key': process.env.INTERNAL_SERVICE_KEY || '',
    ...(correlationId ? { 'x-correlation-id': correlationId } : {}),
  };
}

// EP-204-S5 — delegationId (present only when the invoking caller
// authenticated with an agent-issued token) rides in labels_json alongside
// the other contextual ids (server_id, tool_id, workflow_id) rather than
// getting its own hypertable column — same tier as everything else here
// except correlation_id, which EP-102-S2 promoted for its indexed
// drill-down query. This is what lets an audit trail join a tool
// invocation back to the exact delegation record that authorized it.
async function recordInvocationEvent({
  correlationId, serverId, toolId, toolName, clientId, clientName, workflowId, delegationId,
  outcome, durationMs, startedAt, completedAt,
  redactedArguments, redactedOutput, redactionApplied, redactionFailed,
}) {
  try {
    await fetch(`${TELEMETRY_URL}/metrics`, {
      method: 'POST',
      headers: serviceHeaders({ 'Content-Type': 'application/json' }, correlationId),
      body: JSON.stringify({
        service_name: `mcp_tool:${toolId}`,
        metric_name: 'mcp_tool_invocation',
        value: outcome === 'success' ? 1 : 0,
        correlation_id: correlationId,
        labels_json: {
          correlation_id: correlationId,
          server_id: serverId,
          tool_id: toolId,
          tool_name: toolName,
          client_id: clientId,
          client_name: clientName,
          workflow_id: workflowId,
          delegation_id: delegationId,
          outcome,
          duration_ms: durationMs,
          started_at: startedAt,
          completed_at: completedAt,
          arguments: redactedArguments,
          output: redactedOutput,
          redaction_applied: redactionApplied,
          redaction_failed: redactionFailed,
        },
      }),
    });
  } catch (err) {
    console.error('[telemetry-client] Failed to record MCP invocation event:', err.message);
  }
}

// Queries invocation telemetry by any combination of correlation ID, server,
// tool, client, workflow, and time range (Feature 6.1's API-consumer story).
async function queryInvocations({ correlation_id, server_id, tool_id, client_id, workflow_id, from, to, limit } = {}) {
  const params = new URLSearchParams({ metric_name: 'mcp_tool_invocation' });
  if (correlation_id) params.set('label_correlation_id', correlation_id);
  if (server_id)      params.set('label_server_id', server_id);
  if (tool_id)        params.set('label_tool_id', tool_id);
  if (client_id)      params.set('label_client_id', client_id);
  if (workflow_id)    params.set('label_workflow_id', workflow_id);
  if (from)           params.set('from', from);
  if (to)             params.set('to', to);
  if (limit)          params.set('limit', limit);

  try {
    const res = await fetch(`${TELEMETRY_URL}/metrics?${params}`, { headers: serviceHeaders() });
    if (!res.ok) return [];
    return await res.json().catch(() => []);
  } catch {
    return [];
  }
}

export default { recordInvocationEvent, queryInvocations };
