import { Router } from 'express';
import pool from '../../db.js';
import { requirePermission } from '../lib/require-auth.js';

const router = Router();
const wrap = fn => (req, res) => fn(req, res).catch(err => {
  console.error(err.message);
  res.status(500).json({ error: err.message });
});

// EP-103-S2/S3 — the platform-wide, append-only approval decision log.
// Written to by mcp-governance-service (and, as the platform grows, any
// other service with an approve/reject/waive-type action) whenever it
// records one in its own local history — this is the cross-cutting audit
// trail, not a replacement for those per-asset tables.
// S2.9 (2026-10-08, finding F-04) — mcp-governance-service's own call site
// (governance-client.js's recordApprovalDecision) already derives actor/role
// from the human caller it authenticated itself, so a service-key request's
// claimed actor/role is trustworthy as-is. But this route has no isService
// check, so a human session holding mcp:approve could call it directly and
// write an arbitrary actor/role into this append-only log — close that by
// overriding actor/role from req.user whenever the caller isn't a service.
router.post('/', requirePermission('mcp:approve'), wrap(async (req, res) => {
  const { asset_type, asset_id, decision, supporting_evidence, expiration } = req.body;
  const actor = req.user?.isService ? req.body.actor : req.user?.username;
  const role  = req.user?.isService ? (req.body.role ?? null) : (req.user?.roles?.[0] ?? null);
  if (!asset_type || !asset_id || !decision || !actor) {
    return res.status(400).json({ error: 'asset_type, asset_id, decision, and actor are required' });
  }

  const { rows: [row] } = await pool.query(
    `INSERT INTO approval_decision_history
       (asset_type, asset_id, decision, actor, role, supporting_evidence, expiration)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [asset_type, asset_id, decision, actor, role, supporting_evidence ?? null, expiration ?? null]
  );
  res.status(201).json(row);
}));

// GET /approval-decisions?asset_type=&asset_id=&asset_ids= — chronological
// (most recent first) decision log. asset_ids (comma-separated) is EP-103-S7's
// unified MCP server history tab asking in one call for the server's own
// decisions plus every one of its tools'/prompts' — each has a different
// asset_id (and usually asset_type), so a single asset_id filter can't cover it.
router.get('/', wrap(async (req, res) => {
  const { asset_type, asset_id, asset_ids } = req.query;
  const conditions = [];
  const params = [];
  if (asset_type) { conditions.push(`asset_type = $${params.push(asset_type)}`); }
  if (asset_ids)  { conditions.push(`asset_id = ANY($${params.push(asset_ids.split(','))}::text[])`); }
  else if (asset_id) { conditions.push(`asset_id = $${params.push(asset_id)}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT * FROM approval_decision_history ${where} ORDER BY decided_at DESC`,
    params
  );
  res.json(rows);
}));

export default router;
