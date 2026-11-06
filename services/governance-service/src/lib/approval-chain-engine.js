// EP-202-S2 — the multi-stage approval state machine. A chain (template) has
// an ordered/parallel set of stages, each naming an approver_role and a
// quorum (how many distinct approvers with that role must sign off). A
// request is one asset's in-flight run through a chain; decisions are the
// individual approve/reject actions.
//
// sequential: stage N+1 only becomes decidable once stage N's quorum is met.
// parallel: every stage is open from the start; the request completes once
// EVERY stage independently reaches its quorum.
// A single 'rejected' decision at any stage, in either mode, ends the whole
// request as rejected — one veto is enough, matching how every other
// approval surface in this platform already works (waivers, MCP tool/server
// approval).

import pool from '../../db.js';

// EP-202-S8 (forward-looking) — when a chain reaches a terminal state, the
// asset that requested it needs to hear about it so it can actually change
// state (governance-service has no business writing into another service's
// schema directly, even though it's technically the same Postgres instance
// — see rule-evaluator.js's read-only cross-schema queries for the one
// place that's already accepted, and note this is deliberately NOT doing
// the same for writes). Same fail-soft fetch-wrapper convention as every
// other cross-service client in this codebase.
const ASSET_CALLBACKS = {
  mcp_server: (assetId) => {
    const base = process.env.MCP_GOVERNANCE_SERVICE_URL || 'http://mcp-governance-service:3306';
    return `${base}/servers/${assetId}/approval-chain-decided`;
  },
};

async function notifyAsset(assetType, assetId, request) {
  const buildUrl = ASSET_CALLBACKS[assetType];
  if (!buildUrl) return;
  try {
    await fetch(buildUrl(assetId), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Service-Key': process.env.INTERNAL_SERVICE_KEY || '',
      },
      body: JSON.stringify({ request_id: request.id, decision: request.status }),
    });
  } catch (err) {
    console.error('[approval-chain-engine] Failed to notify asset of chain decision:', err.message);
  }
}

async function findActiveChainForRiskTier(riskTier) {
  const { rows: [chain] } = await pool.query(
    `SELECT * FROM approval_chains WHERE risk_tier = $1 AND status = 'active' LIMIT 1`,
    [riskTier]
  );
  return chain ?? null;
}

async function startChainRequest({ chainId, assetType, assetId, requestedBy, reason }) {
  const { rows: [request] } = await pool.query(
    `INSERT INTO approval_chain_requests (chain_id, asset_type, asset_id, requested_by, reason)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [chainId, assetType, assetId, requestedBy, reason ?? null]
  );
  return request;
}

async function getRequestDetail(requestId) {
  const { rows: [request] } = await pool.query(
    `SELECT r.*, c.name AS chain_name, c.execution_mode, c.stages
       FROM approval_chain_requests r JOIN approval_chains c ON c.id = r.chain_id
      WHERE r.id = $1`,
    [requestId]
  );
  if (!request) return null;

  const { rows: decisions } = await pool.query(
    `SELECT * FROM approval_chain_decisions WHERE request_id = $1 ORDER BY decided_at ASC`,
    [requestId]
  );
  return { ...request, decisions };
}

function stageQuorumMet(stage, decisions) {
  const approvals = decisions.filter(d => d.stage_order === stage.order && d.decision === 'approved');
  // Quorum counts distinct approvers, not raw decision rows — the same
  // person approving twice must not count twice toward quorum.
  const distinctApprovers = new Set(approvals.map(d => d.actor));
  return distinctApprovers.size >= stage.quorum;
}

// Throws a { status, message } error object for the route layer to surface
// directly — keeps the validation rules in one place instead of duplicated
// between the engine and the route.
function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  throw err;
}

async function recordDecision({ requestId, stageOrder, actor, actorRoles, decision, reason }) {
  const request = await getRequestDetail(requestId);
  if (!request) return null;
  if (request.status !== 'pending') fail(409, `This approval request is already ${request.status}`);
  if (actor === request.requested_by) fail(403, 'The approver must be different from the requester');

  const stages = request.stages;
  const stage = stages.find(s => s.order === stageOrder);
  if (!stage) fail(400, `Stage ${stageOrder} does not exist on this chain`);
  if (!actorRoles.includes(stage.approver_role)) {
    fail(403, `This stage requires the '${stage.approver_role}' role`);
  }

  if (request.execution_mode === 'sequential' && stageOrder !== request.current_stage) {
    fail(409, `Stage ${stageOrder} is not yet open — the chain is currently on stage ${request.current_stage}`);
  }

  await pool.query(
    `INSERT INTO approval_chain_decisions (request_id, stage_order, actor, decision, reason)
     VALUES ($1, $2, $3, $4, $5)`,
    [requestId, stageOrder, actor, decision, reason ?? null]
  );

  if (decision === 'rejected') {
    const { rows: [updated] } = await pool.query(
      `UPDATE approval_chain_requests SET status = 'rejected', decided_at = NOW() WHERE id = $1 RETURNING *`,
      [requestId]
    );
    await notifyAsset(request.asset_type, request.asset_id, updated);
    return updated;
  }

  // Re-fetch decisions including the one just recorded, to evaluate quorum.
  const { rows: allDecisions } = await pool.query(
    `SELECT * FROM approval_chain_decisions WHERE request_id = $1`,
    [requestId]
  );

  if (request.execution_mode === 'parallel') {
    const allStagesMet = stages.every(s => stageQuorumMet(s, allDecisions));
    if (!allStagesMet) return { ...request, decisions: allDecisions };

    const { rows: [updated] } = await pool.query(
      `UPDATE approval_chain_requests SET status = 'approved', decided_at = NOW() WHERE id = $1 RETURNING *`,
      [requestId]
    );
    await notifyAsset(request.asset_type, request.asset_id, updated);
    return updated;
  }

  // sequential
  if (!stageQuorumMet(stage, allDecisions)) return { ...request, decisions: allDecisions };

  const maxOrder = Math.max(...stages.map(s => s.order));
  if (stageOrder < maxOrder) {
    const { rows: [updated] } = await pool.query(
      `UPDATE approval_chain_requests SET current_stage = $1 WHERE id = $2 RETURNING *`,
      [stageOrder + 1, requestId]
    );
    return updated;
  }

  const { rows: [updated] } = await pool.query(
    `UPDATE approval_chain_requests SET status = 'approved', decided_at = NOW() WHERE id = $1 RETURNING *`,
    [requestId]
  );
  await notifyAsset(request.asset_type, request.asset_id, updated);
  return updated;
}

export default { findActiveChainForRiskTier, startChainRequest, getRequestDetail, recordDecision };
