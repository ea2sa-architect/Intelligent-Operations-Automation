// E7-S1.4 — usage_budgets CRUD. Validation here mirrors
// 004_usage_budgets.sql's CHECK constraints exactly (design.md D3) — a raw
// Postgres constraint violation is a bad API error.

import { Router } from 'express';
import pool from '../../db.js';
import { requirePermission } from '../lib/require-auth.js';

const router = Router();
const wrap = fn => (req, res) => fn(req, res).catch(err => {
  console.error(err.message);
  res.status(500).json({ error: err.message });
});

const SCOPE_TYPES = ['model_id', 'user_id', 'service_id', 'workflow_id'];
const PERIODS = ['daily', 'monthly'];
const MODES = ['soft', 'hard'];

// List budgets — active by default, ?status=archived for the archive view.
router.get('/', wrap(async (req, res) => {
  const status = req.query.status === 'archived' ? 'archived' : 'active';
  const { rows } = await pool.query(
    "SELECT * FROM usage_budgets WHERE status = $1 ORDER BY created_at DESC",
    [status]
  );
  res.json(rows);
}));

// Create a budget
router.post('/', requirePermission('inference:manage'), wrap(async (req, res) => {
  const { scope_type, scope_value, period, limit_usd, mode = 'soft' } = req.body;

  if (!SCOPE_TYPES.includes(scope_type)) return res.status(400).json({ error: `scope_type must be one of: ${SCOPE_TYPES.join(', ')}` });
  if (!scope_value) return res.status(400).json({ error: 'scope_value is required' });
  if (!PERIODS.includes(period)) return res.status(400).json({ error: `period must be one of: ${PERIODS.join(', ')}` });
  if (!limit_usd || Number(limit_usd) <= 0) return res.status(400).json({ error: 'limit_usd must be a positive number' });
  if (!MODES.includes(mode)) return res.status(400).json({ error: `mode must be one of: ${MODES.join(', ')}` });

  const { rows: [budget] } = await pool.query(
    `INSERT INTO usage_budgets (scope_type, scope_value, period, limit_usd, mode)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [scope_type, scope_value, period, limit_usd, mode]
  );
  res.status(201).json(budget);
}));

// Update a budget — scope_type is immutable (design.md D2); changing it is
// semantically a new budget, not an edit.
router.put('/:id', requirePermission('inference:manage'), wrap(async (req, res) => {
  const { scope_value, period, limit_usd, mode } = req.body;

  if (period !== undefined && !PERIODS.includes(period)) return res.status(400).json({ error: `period must be one of: ${PERIODS.join(', ')}` });
  if (limit_usd !== undefined && Number(limit_usd) <= 0) return res.status(400).json({ error: 'limit_usd must be a positive number' });
  if (mode !== undefined && !MODES.includes(mode)) return res.status(400).json({ error: `mode must be one of: ${MODES.join(', ')}` });

  const { rows: [budget] } = await pool.query(
    `UPDATE usage_budgets
        SET scope_value = COALESCE($1, scope_value),
            period      = COALESCE($2, period),
            limit_usd   = COALESCE($3, limit_usd),
            mode        = COALESCE($4, mode),
            updated_at  = NOW()
      WHERE id = $5
  RETURNING *`,
    [scope_value ?? null, period ?? null, limit_usd ?? null, mode ?? null, req.params.id]
  );
  if (!budget) return res.status(404).json({ error: 'Budget not found' });
  res.json(budget);
}));

// Archive a budget — never a hard delete (design.md D1). PATCH, not
// DELETE: Kong's route for this service (bootstrap/platform.config.yaml)
// only allows GET/POST/PUT/PATCH, and since this never actually deletes
// the row, PATCH .../archive is the more honest verb anyway — found by
// Task 5's real browser verification (a Kong 404, not an app bug) rather
// than assumed. checkBudget()'s existing status='active' filter (S1.1)
// means an archived budget is simply never matched again.
router.patch('/:id/archive', requirePermission('inference:manage'), wrap(async (req, res) => {
  const { rows: [budget] } = await pool.query(
    "UPDATE usage_budgets SET status = 'archived', updated_at = NOW() WHERE id = $1 RETURNING *",
    [req.params.id]
  );
  if (!budget) return res.status(404).json({ error: 'Budget not found' });
  res.json(budget);
}));

export default router;
