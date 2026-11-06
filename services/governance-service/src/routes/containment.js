import { Router } from 'express';
import pool from '../../db.js';
import containmentClient from '../lib/containment-client.js';
import { requirePermission } from '../lib/require-auth.js';

const router = Router();
const wrap = fn => (req, res) => fn(req, res).catch(err => {
  console.error(err.message);
  res.status(502).json({ error: err.message });
});

const ASSET_TYPES = ['mcp_server', 'mcp_tool', 'workflow'];
const ACTION_TO_STATE = { suspend: 'suspended', quarantine: 'quarantined', restore: 'active', 'read-only': 'read_only' };

const CONTAINMENT_STATE_QUERIES = {
  mcp_server: 'SELECT containment_state FROM mcp_governance.mcp_servers WHERE id = $1',
  mcp_tool:   'SELECT containment_state FROM mcp_governance.mcp_tools WHERE id = $1',
  workflow:   'SELECT containment_state FROM workflow_governance.workflows WHERE id = $1',
};

// EP-203-S3/S4/S6/S7 — audit-AFTER, not audit-first: containmentClient
// throws (not fail-soft) if the owning service can't confirm the state
// actually changed, and this handler lets that propagate as a 502 rather
// than writing a containment_log row that would claim an action succeeded
// when it didn't. A kill switch that silently no-ops must not report success.
async function performContainment(req, res, action) {
  const { type, id } = req.params;
  const { reason } = req.body;
  if (!ASSET_TYPES.includes(type)) return res.status(400).json({ error: `type must be one of: ${ASSET_TYPES.join(', ')}` });
  if (['suspend', 'quarantine'].includes(action) && !reason) {
    return res.status(400).json({ error: 'reason is required' });
  }

  await containmentClient.applyContainment(type, id, ACTION_TO_STATE[action]);

  const { rows: [entry] } = await pool.query(
    `INSERT INTO containment_log (asset_type, asset_id, action, actor, reason) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [type, id, action, req.user?.username ?? 'unknown', reason ?? null]
  );
  res.status(201).json(entry);
}

// EP-308-S4 — gated with violation:resolve: containment is the kill-switch
// response to a violation/incident (the Incident page exposes these actions
// directly), the same tier of action as governance-service's violation
// resolve/waiver endpoints.
// EP-203-S3
router.post('/:type/:id/suspend', requirePermission('violation:resolve'), wrap((req, res) => performContainment(req, res, 'suspend')));
// EP-203-S4 — "full isolation, blocks enforcement pathway": see
// routes/enforcement.js, which checks containment_state before evaluating
// any policy at all.
router.post('/:type/:id/quarantine', requirePermission('violation:resolve'), wrap((req, res) => performContainment(req, res, 'quarantine')));
router.post('/:type/:id/restore', requirePermission('violation:resolve'), wrap((req, res) => performContainment(req, res, 'restore')));
router.post('/:type/:id/read-only', requirePermission('violation:resolve'), wrap((req, res) => performContainment(req, res, 'read-only')));

// EP-203-S5
router.post('/:type/:id/rollback', requirePermission('violation:resolve'), wrap(async (req, res) => {
  const { type, id } = req.params;
  const { reason } = req.body;
  if (type !== 'mcp_tool') {
    return res.status(400).json({
      error: `rollback is only supported for asset_type 'mcp_tool' today — no definition-snapshot history exists yet for '${type}'`,
    });
  }

  const result = await containmentClient.rollbackTool(id);

  const { rows: [entry] } = await pool.query(
    `INSERT INTO containment_log (asset_type, asset_id, action, actor, reason, detail_json) VALUES ($1, $2, 'rollback', $3, $4, $5) RETURNING *`,
    [type, id, req.user?.username ?? 'unknown', reason ?? null, JSON.stringify(result)]
  );
  res.status(201).json(entry);
}));

router.get('/:type/:id/containment', wrap(async (req, res) => {
  const { type, id } = req.params;
  const stateQuery = CONTAINMENT_STATE_QUERIES[type];
  if (!stateQuery) return res.status(400).json({ error: `type must be one of: ${ASSET_TYPES.join(', ')}` });

  const { rows: [asset] } = await pool.query(stateQuery, [id]);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });

  const { rows: log } = await pool.query(
    `SELECT * FROM containment_log WHERE asset_type = $1 AND asset_id = $2 ORDER BY created_at DESC`,
    [type, id]
  );
  res.json({ containment_state: asset.containment_state, log });
}));

export default router;
