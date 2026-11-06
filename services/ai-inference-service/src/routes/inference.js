import { Router } from 'express';
import { createHash } from 'crypto';
import pool from '../../db.js';
import telemetryClient from '../lib/telemetry-client.js';
import governanceClient from '../lib/governance-client.js';
import spendCheck from '../lib/spend-check.js';
import escalationClient from '../lib/escalation-client.js';
import { requirePermission } from '../lib/require-auth.js';

const router = Router();
const wrap = fn => (req, res) => fn(req, res).catch(err => {
  console.error(err.message);
  res.status(500).json({ error: err.message });
});

// List inference requests — static routes MUST come before /:id
router.get('/', wrap(async (req, res) => {
  const { model_id, status, limit = 50, offset = 0 } = req.query;
  const conditions = [];
  const params = [];

  if (model_id) { conditions.push(`r.model_id = $${params.push(model_id)}`); }
  if (status)   { conditions.push(`r.status   = $${params.push(status)}`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(Number(limit), Number(offset));

  const { rows } = await pool.query(
    `SELECT r.*,
            m.name AS model_name,
            COUNT(d.id)::int                                                       AS decision_count,
            (SELECT outcome FROM decisions
              WHERE inference_request_id = r.id
              ORDER BY created_at DESC LIMIT 1)                                    AS latest_outcome
       FROM inference_requests r
       JOIN models m ON m.id = r.model_id
       LEFT JOIN decisions d ON d.inference_request_id = r.id
      ${where}
      GROUP BY r.id, m.name
      ORDER BY r.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  res.json(rows);
}));

// List decisions across all requests — must be before /:id
router.get('/decisions', wrap(async (req, res) => {
  const { policy_id, outcome, limit = 50, offset = 0 } = req.query;
  const conditions = [];
  const params = [];

  if (policy_id) { conditions.push(`d.policy_id = $${params.push(policy_id)}`); }
  if (outcome)   { conditions.push(`d.outcome   = $${params.push(outcome)}`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(Number(limit), Number(offset));

  const { rows } = await pool.query(
    `SELECT d.*,
            m.name        AS model_name,
            r.created_at  AS request_created_at
       FROM decisions d
       JOIN inference_requests r ON r.id = d.inference_request_id
       JOIN models m ON m.id = r.model_id
      ${where}
      ORDER BY d.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  res.json(rows);
}));

// Submit inference request.
// EP-102-S4/S5/S7 — accepts the request-scoped GenAI-convention context
// fields (who's asking, what prompt/tool/workflow this is for) that aren't
// knowable yet at completion time (PUT /:id below); they're persisted here
// and merged with completion-time metrics when the telemetry event is
// eventually emitted.
router.post('/', requirePermission('inference:manage'), wrap(async (req, res) => {
  const {
    model_id, input, prompt_template_version, mcp_server_id, mcp_tool_id,
    data_classification, user_id, service_id, workflow_id, business_transaction_id,
    // Lineage n8n-execution linkage — optional, sent by the triggering n8n
    // workflow's own HTTP Request node via its built-in $execution.id /
    // $node.name expressions. See 005_n8n_execution_linkage.sql.
    n8n_execution_id, n8n_node_name,
  } = req.body;
  if (!model_id || !input) return res.status(400).json({ error: 'model_id and input are required' });

  const { rows: [model] } = await pool.query(
    "SELECT * FROM models WHERE id = $1 AND status = 'active'",
    [model_id]
  );
  if (!model) return res.status(404).json({ error: 'Active model not found' });

  // EP-201-S12/S13 — checks models.is_sanctioned and, if present,
  // data_classification against the model-governance policy, before this
  // request is ever recorded. See docs/enforcement-adapter-contract.md.
  const enforcement = await governanceClient.checkEnforcement({
    modelId: model_id, dataClassification: data_classification ?? null, correlationId: req.correlationId,
  });
  if (enforcement.status === 403) {
    return res.status(403).json({
      error: 'Blocked by governance policy',
      decision: enforcement.body.decision,
      blocked_by: enforcement.body.blocked_by ?? null,
      reason: enforcement.body.reason ?? null,
    });
  }
  if (enforcement.body?.decision === 'warn' && enforcement.body.warnings?.length) {
    res.set('X-IOA-Warning', enforcement.body.warnings.map(w => w.policy_name).join('; '));
  }

  // E7-S1.2 — check every scope dimension present on this request
  // (a budget could be bound to any one of them, not just user_id); first
  // hard-mode breach blocks, any soft breach/warn proceeds with a header.
  // See work/epics/e1-ai-usage-budgets/design.md.
  const scopeChecks = [
    { scopeType: 'model_id', scopeValue: model_id },
    { scopeType: 'user_id', scopeValue: user_id },
    { scopeType: 'service_id', scopeValue: service_id },
    { scopeType: 'workflow_id', scopeValue: workflow_id },
  ].filter(s => s.scopeValue != null);

  const budgetResults = (await Promise.all(scopeChecks.map(s => spendCheck.checkBudget(s))))
    .filter(r => r.status !== 'ok');

  const hardBreach = budgetResults.find(r => r.status === 'breach' && r.budget.mode === 'hard');
  if (hardBreach) {
    return res.status(403).json({ error: 'Blocked by usage budget', budget: hardBreach.budget });
  }
  if (budgetResults.length > 0) {
    res.set('X-IOA-Budget-Warning', budgetResults
      .map(r => `${r.budget.scope_type}=${r.budget.scope_value}:${r.status}`)
      .join('; '));
  }

  const input_hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');

  const { rows: [request] } = await pool.query(
    `INSERT INTO inference_requests
       (model_id, input_hash, status, prompt_template_version, mcp_server_id, mcp_tool_id,
        data_classification, user_id, service_id, workflow_id, business_transaction_id,
        n8n_execution_id, n8n_node_name)
     VALUES ($1, $2, 'pending', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      model_id, input_hash, prompt_template_version ?? null, mcp_server_id ?? null, mcp_tool_id ?? null,
      data_classification ?? null, user_id ?? null, service_id ?? null, workflow_id ?? null, business_transaction_id ?? null,
      n8n_execution_id ?? null, n8n_node_name ?? null,
    ]
  );
  res.status(202).json(request);
}));

// Update inference request (e.g. mark failed, attach output/latency).
// EP-102-S4/S5 — also accepts the completion-only metrics (token counts,
// estimated cost) that aren't known until the model actually responds.
// Once persisted, emits one telemetry event merging these with the
// request-scoped context fields captured at POST / time (model, prompt
// version, MCP server/tool, data classification, identity, workflow,
// business transaction) — that merge is why this needs the model join
// rather than just RETURNING inference_requests.*.
router.put('/:id', requirePermission('inference:manage'), wrap(async (req, res) => {
  const { status, output_json, latency_ms, error_message, input_tokens, output_tokens, estimated_cost_usd } = req.body;
  const { rows: [request] } = await pool.query(
    `UPDATE inference_requests r
        SET status              = COALESCE($1, r.status),
            output_json         = COALESCE($2, r.output_json),
            latency_ms          = COALESCE($3, r.latency_ms),
            error_message       = COALESCE($4, r.error_message),
            input_tokens        = COALESCE($5, r.input_tokens),
            output_tokens       = COALESCE($6, r.output_tokens),
            estimated_cost_usd  = COALESCE($7, r.estimated_cost_usd)
      FROM models m
      WHERE r.model_id = m.id AND r.id = $8
  RETURNING r.*, m.name AS model_name, m.provider`,
    [
      status ?? null, output_json ?? null, latency_ms ?? null, error_message ?? null,
      input_tokens ?? null, output_tokens ?? null, estimated_cost_usd ?? null, req.params.id,
    ],
  );
  if (!request) return res.status(404).json({ error: 'Inference request not found' });

  // Only a terminal state is worth a telemetry event — 'pending' updates
  // (e.g. a caller polling latency_ms mid-stream) aren't a completed call yet.
  if (request.status === 'completed' || request.status === 'failed') {
    await telemetryClient.recordInferenceEvent({
      correlationId: req.correlationId,
      modelId: request.model_id,
      modelName: request.model_name,
      provider: request.provider,
      promptTemplateVersion: request.prompt_template_version,
      mcpServerId: request.mcp_server_id,
      mcpToolId: request.mcp_tool_id,
      dataClassification: request.data_classification,
      userId: request.user_id,
      serviceId: request.service_id,
      workflowId: request.workflow_id,
      businessTransactionId: request.business_transaction_id,
      n8nExecutionId: request.n8n_execution_id,
      n8nNodeName: request.n8n_node_name,
      status: request.status,
      latencyMs: request.latency_ms,
      inputTokens: request.input_tokens,
      outputTokens: request.output_tokens,
      estimatedCostUsd: request.estimated_cost_usd,
    });
  }

  // E7-S1.3 — re-check budgets now that this request's own cost is
  // known (not knowable at POST / time — see design.md). Only 'completed'
  // has a realized cost worth checking; never blocks (S1.2 already gated
  // creation). First breach found fires one incident, not one per scope.
  if (request.status === 'completed') {
    const scopeChecks = [
      { scopeType: 'model_id', scopeValue: request.model_id },
      { scopeType: 'user_id', scopeValue: request.user_id },
      { scopeType: 'service_id', scopeValue: request.service_id },
      { scopeType: 'workflow_id', scopeValue: request.workflow_id },
    ].filter(s => s.scopeValue != null);

    const results = await Promise.all(scopeChecks.map(s => spendCheck.checkBudget(s)));
    const breach = results.find(r => r.status === 'breach');
    if (breach) {
      await escalationClient.createIncident({
        title: `Usage budget exceeded: ${breach.budget.scope_type}=${breach.budget.scope_value}`,
        severity: breach.budget.mode === 'hard' ? 'high' : 'medium',
        contextJson: { budget_id: breach.budget.id, spent_usd: breach.spent_usd, limit_usd: breach.limit_usd },
      });
    }
  }

  res.json(request);
}));

// Get one inference request + its decisions
router.get('/:id', wrap(async (req, res) => {
  const { rows: [request] } = await pool.query(
    `SELECT r.*, m.name AS model_name
       FROM inference_requests r
       JOIN models m ON m.id = r.model_id
      WHERE r.id = $1`,
    [req.params.id]
  );
  if (!request) return res.status(404).json({ error: 'Inference request not found' });

  const { rows: decisions } = await pool.query(
    'SELECT * FROM decisions WHERE inference_request_id = $1 ORDER BY created_at DESC',
    [req.params.id]
  );
  res.json({ ...request, decisions });
}));

// Record a decision against a request.
// EP-102-S6 — also emits a policy_decision telemetry event so a call's
// governance outcome shows up in the same correlation chain as its
// model_inference/token/cost events.
router.post('/:id/decisions', requirePermission('inference:manage'), wrap(async (req, res) => {
  const { policy_id, outcome, confidence, reasoning_json } = req.body;
  if (!outcome) return res.status(400).json({ error: 'outcome is required' });

  const { rows: [decision] } = await pool.query(
    'INSERT INTO decisions (inference_request_id, policy_id, outcome, confidence, reasoning_json) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [req.params.id, policy_id ?? null, outcome, confidence ?? null, reasoning_json ?? null]
  );

  const { rows: [request] } = await pool.query(
    "UPDATE inference_requests SET status = 'completed' WHERE id = $1 RETURNING model_id",
    [req.params.id]
  );

  if (request) {
    await telemetryClient.recordPolicyDecisionEvent({
      correlationId: req.correlationId,
      modelId: request.model_id,
      inferenceRequestId: req.params.id,
      policyId: policy_id ?? null,
      outcome,
      confidence: confidence ?? null,
    });
  }

  res.status(201).json(decision);
}));

export default router;
