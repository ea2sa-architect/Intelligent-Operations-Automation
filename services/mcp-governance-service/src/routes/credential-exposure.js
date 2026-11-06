import { Router } from 'express';
import pool from '../../db.js';
import { requirePermission } from '../lib/require-auth.js';

const router = Router();
const wrap = fn => (req, res) => fn(req, res).catch(err => res.status(500).json({ error: err.message }));

// EP-101-S8/S9 — records that someone claims to have rotated this
// credential. Doesn't resolve the finding itself: the row stays until the
// next write to the source asset either drops it (fingerprint gone —
// genuinely rotated) or reinserts it with this same rotation_confirmed_at
// carried forward (fingerprint still present — the claim didn't hold).
// EP-308-S4 — violation:resolve, not mcp:register: this is resolving a
// security finding, same action class as governance-service's
// violation/waiver endpoints, not registry maintenance.
router.patch('/credential-exposure/:id/confirm-rotation', requirePermission('violation:resolve'), wrap(async (req, res) => {
  const { confirmed_by } = req.body;
  if (!confirmed_by) return res.status(400).json({ error: 'confirmed_by is required' });

  const { rows: [row] } = await pool.query(
    `UPDATE mcp_governance.mcp_credential_exposure
        SET rotation_confirmed_at = NOW(), rotation_confirmed_by = $1
      WHERE id = $2
      RETURNING *`,
    [confirmed_by, req.params.id]
  );
  if (!row) return res.status(404).json({ error: 'Credential exposure finding not found' });
  res.json(row);
}));

export default router;
