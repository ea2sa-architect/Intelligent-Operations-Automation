import { Router } from 'express';
import pool from '../../db.js';
import approvalChainEngine from '../lib/approval-chain-engine.js';
import { requirePermission } from '../lib/require-auth.js';

const router = Router();
const wrap = fn => (req, res) => fn(req, res).catch(err => {
  if (err.status) return res.status(err.status).json({ error: err.message });
  console.error(err.message);
  res.status(500).json({ error: err.message });
});

const RISK_TIERS = ['low', 'moderate', 'high', 'critical'];
const EXECUTION_MODES = ['sequential', 'parallel'];

function validateStages(stages) {
  if (!Array.isArray(stages) || stages.length === 0) return 'stages must be a non-empty array';
  for (const s of stages) {
    if (typeof s.order !== 'number' || s.order < 1) return 'each stage requires a positive numeric order';
    if (!s.approver_role) return 'each stage requires an approver_role';
    if (typeof s.quorum !== 'number' || s.quorum < 1) return 'each stage requires a positive numeric quorum';
  }
  const orders = stages.map(s => s.order);
  if (new Set(orders).size !== orders.length) return 'stage order values must be unique';
  return null;
}

// ── Requests (one asset's in-flight run through a chain) ────────────────
// Registered BEFORE the /:id chain-template routes below — otherwise
// Express matches "requests" itself as a chain-template :id (a wildcard
// route registered first always wins), producing an invalid-UUID query
// error instead of ever reaching these handlers.

// POST /approval-chains/requests — start a chain for an asset, either by
// explicit chain_id or by risk_tier lookup (the common case: "what's the
// active chain for this risk tier").
router.post('/requests', requirePermission('mcp:register'), wrap(async (req, res) => {
  const { chain_id, risk_tier, asset_type, asset_id, reason, requested_by } = req.body;
  if (!asset_type || !asset_id) return res.status(400).json({ error: 'asset_type and asset_id are required' });
  if (!chain_id && !risk_tier) return res.status(400).json({ error: 'chain_id or risk_tier is required' });

  let chain;
  if (chain_id) {
    const { rows: [c] } = await pool.query('SELECT * FROM approval_chains WHERE id = $1 AND status = $2', [chain_id, 'active']);
    chain = c;
  } else {
    chain = await approvalChainEngine.findActiveChainForRiskTier(risk_tier);
  }
  if (!chain) return res.status(404).json({ error: 'No active approval chain found' });

  // S2.9 (2026-10-08, finding F-05) — requested_by in the body is trusted
  // ONLY for service-to-service callers (e.g. mcp-governance-service
  // starting a chain on a human's behalf, authenticated as
  // 'internal-service' via the shared key, where the actual requester's
  // identity lives in THEIR request, not this one — same pattern
  // recordApprovalDecision uses for actor/role). A human session calling
  // this route directly gets requested_by forced to their own identity:
  // previously a single account holding both mcp:register and mcp:approve
  // could set requested_by to an arbitrary non-matching string and
  // trivially pass the approver !== requested_by separation-of-duties
  // check in approval-chain-engine.js while effectively self-approving.
  const request = await approvalChainEngine.startChainRequest({
    chainId: chain.id, assetType: asset_type, assetId: asset_id,
    requestedBy: req.user?.isService ? (requested_by ?? 'unknown') : (req.user?.username ?? 'unknown'), reason,
  });
  res.status(201).json({ ...request, chain_name: chain.name, execution_mode: chain.execution_mode, stages: chain.stages });
}));

router.get('/requests', wrap(async (req, res) => {
  const { asset_type, asset_id, status } = req.query;
  const conditions = [];
  const params = [];
  if (asset_type) conditions.push(`r.asset_type = $${params.push(asset_type)}`);
  if (asset_id)   conditions.push(`r.asset_id = $${params.push(asset_id)}`);
  if (status)     conditions.push(`r.status = $${params.push(status)}`);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT r.*, c.name AS chain_name, c.execution_mode
       FROM approval_chain_requests r JOIN approval_chains c ON c.id = r.chain_id
       ${where}
      ORDER BY r.requested_at DESC`,
    params
  );
  res.json(rows);
}));

router.get('/requests/:id', wrap(async (req, res) => {
  const request = await approvalChainEngine.getRequestDetail(req.params.id);
  if (!request) return res.status(404).json({ error: 'Approval request not found' });
  res.json(request);
}));

// POST /approval-chains/requests/:id/decisions — record one stage decision.
// EP-202-S3 — the requester≠approver check happens inside the engine, same
// as the waiver flow, so it can't drift out of sync between call sites.
router.post('/requests/:id/decisions', requirePermission('mcp:approve'), wrap(async (req, res) => {
  const { stage_order, decision, reason } = req.body;
  if (typeof stage_order !== 'number') return res.status(400).json({ error: 'stage_order is required' });
  if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ error: "decision must be 'approved' or 'rejected'" });

  const updated = await approvalChainEngine.recordDecision({
    requestId: req.params.id, stageOrder: stage_order,
    actor: req.user?.username ?? 'unknown', actorRoles: req.user?.roles ?? [],
    decision, reason,
  });
  if (!updated) return res.status(404).json({ error: 'Approval request not found' });
  res.json(updated);
}));

// ── Chain templates (admin config) ──────────────────────────────────────

router.get('/', wrap(async (req, res) => {
  const { risk_tier, status } = req.query;
  const conditions = [];
  const params = [];
  if (risk_tier) conditions.push(`risk_tier = $${params.push(risk_tier)}`);
  if (status)    conditions.push(`status = $${params.push(status)}`);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT * FROM approval_chains ${where} ORDER BY risk_tier, created_at DESC`, params
  );
  res.json(rows);
}));

router.get('/:id', wrap(async (req, res) => {
  const { rows: [chain] } = await pool.query('SELECT * FROM approval_chains WHERE id = $1', [req.params.id]);
  if (!chain) return res.status(404).json({ error: 'Approval chain not found' });
  res.json(chain);
}));

router.post('/', requirePermission('policy:edit'), wrap(async (req, res) => {
  const { name, risk_tier, execution_mode = 'sequential', stages } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (!RISK_TIERS.includes(risk_tier)) return res.status(400).json({ error: `risk_tier must be one of: ${RISK_TIERS.join(', ')}` });
  if (!EXECUTION_MODES.includes(execution_mode)) return res.status(400).json({ error: `execution_mode must be one of: ${EXECUTION_MODES.join(', ')}` });
  const stageError = validateStages(stages);
  if (stageError) return res.status(400).json({ error: stageError });

  const { rows: [chain] } = await pool.query(
    `INSERT INTO approval_chains (name, risk_tier, execution_mode, stages) VALUES ($1, $2, $3, $4) RETURNING *`,
    [name, risk_tier, execution_mode, JSON.stringify(stages)]
  );
  res.status(201).json(chain);
}));

router.patch('/:id/status', requirePermission('policy:edit'), wrap(async (req, res) => {
  const VALID = ['active', 'inactive'];
  const { status } = req.body;
  if (!VALID.includes(status)) return res.status(400).json({ error: `status must be one of: ${VALID.join(', ')}` });

  const { rows: [chain] } = await pool.query(
    `UPDATE approval_chains SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [status, req.params.id]
  );
  if (!chain) return res.status(404).json({ error: 'Approval chain not found' });
  res.json(chain);
}));

export default router;
