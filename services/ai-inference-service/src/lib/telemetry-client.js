// EP-102-S4/S5/S6/S7 — reports GenAI-convention inference telemetry into
// telemetry-service, reusing its existing generic metrics-ingestion pattern
// (service_name/metric_name/value/labels_json) exactly the way
// workflow-governance-service and mcp-governance-service's telemetry-client.js
// do — no new hypertable needed, and it's what makes EP-102-S9's cost/token
// trend charts a plain GET /metrics/summary?metric_name=input_tokens (etc.)
// with zero new backend work. Same fail-soft fetch-wrapper pattern as every
// other cross-service client in this codebase: an unreachable
// telemetry-service must not break an inference request.
//
// Records four rows in one batched POST (the /metrics route already accepts
// an array): the inference outcome itself (mirrors workflow execution_status /
// mcp_tool_invocation), plus one row each for input tokens, output tokens,
// and estimated cost — each its own metric_name so a trend chart is a
// straight GROUP BY, not a JSONB unpack. All four share correlation_id and
// the same rich labels_json for drill-down (EP-102-S8).

const TELEMETRY_URL = process.env.TELEMETRY_SERVICE_URL || 'http://localhost:3304';

function serviceHeaders(extra = {}, correlationId) {
  return {
    ...extra,
    'X-Internal-Service-Key': process.env.INTERNAL_SERVICE_KEY || '',
    ...(correlationId ? { 'x-correlation-id': correlationId } : {}),
  };
}

async function recordInferenceEvent({
  correlationId, modelId, modelName, provider, promptTemplateVersion,
  mcpServerId, mcpToolId, dataClassification,
  userId, serviceId, workflowId, businessTransactionId,
  n8nExecutionId, n8nNodeName,
  status, latencyMs, inputTokens, outputTokens, estimatedCostUsd,
}) {
  const labels_json = {
    correlation_id: correlationId,
    model_id: modelId,
    model_name: modelName,
    provider,
    prompt_template_version: promptTemplateVersion,
    mcp_server_id: mcpServerId,
    mcp_tool_id: mcpToolId,
    data_classification: dataClassification,
    user_id: userId,
    service_id: serviceId,
    workflow_id: workflowId,
    business_transaction_id: businessTransactionId,
    // Lineage n8n-execution linkage (see db/migrations/ai_inference/
    // 005_n8n_execution_linkage.sql) — lineage-builder.js spreads
    // labels_json verbatim into lineage_nodes.metadata_json, so these
    // keys reach the Lineage UI with no lineage-builder.js change needed.
    n8n_execution_id: n8nExecutionId,
    n8n_node_name: n8nNodeName,
    status,
    latency_ms: latencyMs,
  };

  const time = new Date();
  const items = [
    { time, service_name: `ai_model:${modelId}`, metric_name: 'model_inference', value: status === 'completed' ? 1 : 0, correlation_id: correlationId, labels_json },
  ];
  if (inputTokens != null)      items.push({ time, service_name: `ai_model:${modelId}`, metric_name: 'input_tokens', value: inputTokens, correlation_id: correlationId, labels_json });
  if (outputTokens != null)     items.push({ time, service_name: `ai_model:${modelId}`, metric_name: 'output_tokens', value: outputTokens, correlation_id: correlationId, labels_json });
  if (estimatedCostUsd != null) items.push({ time, service_name: `ai_model:${modelId}`, metric_name: 'estimated_cost_usd', value: estimatedCostUsd, correlation_id: correlationId, labels_json });

  try {
    await fetch(`${TELEMETRY_URL}/metrics`, {
      method: 'POST',
      headers: serviceHeaders({ 'Content-Type': 'application/json' }, correlationId),
      body: JSON.stringify(items),
    });
  } catch (err) {
    console.error('[telemetry-client] Failed to record inference event:', err.message);
  }
}

// Records a policy decision outcome against an inference call (EP-102-S6).
// Kept as its own event rather than folded into recordInferenceEvent above —
// a request can accumulate multiple decisions (POST /:id/decisions can be
// called more than once), each a distinct point in time worth its own row.
async function recordPolicyDecisionEvent({ correlationId, modelId, inferenceRequestId, policyId, outcome, confidence }) {
  try {
    await fetch(`${TELEMETRY_URL}/metrics`, {
      method: 'POST',
      headers: serviceHeaders({ 'Content-Type': 'application/json' }, correlationId),
      body: JSON.stringify({
        service_name: `ai_model:${modelId}`,
        metric_name: 'policy_decision',
        value: outcome === 'approved' || outcome === 'allowed' ? 1 : 0,
        correlation_id: correlationId,
        labels_json: { correlation_id: correlationId, model_id: modelId, inference_request_id: inferenceRequestId, policy_id: policyId, outcome, confidence },
      }),
    });
  } catch (err) {
    console.error('[telemetry-client] Failed to record policy decision event:', err.message);
  }
}

export default { recordInferenceEvent, recordPolicyDecisionEvent };
