import { Router } from 'express';
import pool from '../../db.js';
import requireAuth, { requirePermission } from '../lib/require-auth.js';

const router = Router();
// AUTH-201 (extended) — this router is entirely SPA-facing, no external
// (n8n) callers, so a single router-level requireAuth is sufficient.
router.use(requireAuth);
const wrap = fn => (req, res) => fn(req, res).catch(err => res.status(500).json({ error: err.message }));

// GET /tags
router.get('/', wrap(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, role, risk_score, color, description, created_at, updated_at
       FROM workflow_governance.tags
      ORDER BY role, name`
  );
  res.json(rows);
}));

// POST /tags
router.post('/', requirePermission('policy:edit'), wrap(async (req, res) => {
  const { name, role = 'general', risk_score, color, description } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const { rows: [tag] } = await pool.query(
    `INSERT INTO workflow_governance.tags (name, role, risk_score, color, description)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [name.trim().toLowerCase(), role, risk_score ?? null, color ?? null, description ?? null]
  );
  res.status(201).json(tag);
}));

// PUT /tags/:id
router.put('/:id', requirePermission('policy:edit'), wrap(async (req, res) => {
  const { name, role, risk_score, color, description } = req.body;
  const { rows: [tag] } = await pool.query(
    `UPDATE workflow_governance.tags
        SET name        = COALESCE($1, name),
            role        = COALESCE($2, role),
            risk_score  = $3,
            color       = $4,
            description = $5,
            updated_at  = NOW()
      WHERE id = $6
      RETURNING *`,
    [
      name ? name.trim().toLowerCase() : null,
      role ?? null,
      risk_score ?? null,
      color ?? null,
      description ?? null,
      req.params.id,
    ]
  );
  if (!tag) return res.status(404).json({ error: 'Tag not found' });
  res.json(tag);
}));

// DELETE /tags/:id
router.delete('/:id', requirePermission('policy:edit'), wrap(async (req, res) => {
  const { rowCount } = await pool.query(
    'DELETE FROM workflow_governance.tags WHERE id = $1',
    [req.params.id]
  );
  if (!rowCount) return res.status(404).json({ error: 'Tag not found' });
  res.status(204).end();
}));

export default router;
