import { Router } from 'express';
import pool from '../../db.js';
import { requirePermission } from '../lib/require-auth.js';

const router = Router();
const wrap = fn => (req, res) => fn(req, res).catch(err => {
  console.error(err.message);
  res.status(500).json({ error: err.message });
});

// List rules
router.get('/', wrap(async (req, res) => {
  const { severity, enabled } = req.query;
  const conditions = [];
  const params = [];

  if (severity) { conditions.push(`severity = $${params.push(severity)}`); }
  if (enabled !== undefined) { conditions.push(`enabled = $${params.push(enabled === 'true')}`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(`SELECT * FROM escalation_rules ${where} ORDER BY severity DESC, name`, params);
  res.json(rows);
}));

// Get one rule
router.get('/:id', wrap(async (req, res) => {
  const { rows: [rule] } = await pool.query('SELECT * FROM escalation_rules WHERE id = $1', [req.params.id]);
  if (!rule) return res.status(404).json({ error: 'Rule not found' });
  res.json(rule);
}));

// Create rule
router.post('/', requirePermission('incident:manage'), wrap(async (req, res) => {
  const { name, condition_json, severity, channels_json, enabled = true } = req.body;
  if (!name || !condition_json || !severity) return res.status(400).json({ error: 'name, condition_json, and severity are required' });

  const { rows: [rule] } = await pool.query(
    'INSERT INTO escalation_rules (name, condition_json, severity, channels_json, enabled) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [name, condition_json, severity, channels_json ?? [], enabled]
  );
  res.status(201).json(rule);
}));

// Update rule
router.put('/:id', requirePermission('incident:manage'), wrap(async (req, res) => {
  const { name, condition_json, severity, channels_json, enabled } = req.body;
  const { rows: [rule] } = await pool.query(
    `UPDATE escalation_rules
        SET name           = COALESCE($1, name),
            condition_json = COALESCE($2, condition_json),
            severity       = COALESCE($3, severity),
            channels_json  = COALESCE($4, channels_json),
            enabled        = COALESCE($5, enabled),
            updated_at     = NOW()
      WHERE id = $6
  RETURNING *`,
    [name ?? null, condition_json ?? null, severity ?? null, channels_json ?? null, enabled ?? null, req.params.id]
  );
  if (!rule) return res.status(404).json({ error: 'Rule not found' });
  res.json(rule);
}));

// Delete rule
router.delete('/:id', requirePermission('incident:manage'), wrap(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM escalation_rules WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Rule not found' });
  res.status(204).end();
}));

export default router;
