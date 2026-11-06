import { Router } from 'express';
import pool from '../../db.js';
import { requirePermission } from '../lib/require-auth.js';

const router = Router();
const wrap = fn => (req, res) => fn(req, res).catch(err => {
  console.error(err.message);
  res.status(500).json({ error: err.message });
});

// List models
router.get('/', wrap(async (req, res) => {
  const { status } = req.query;
  const { rows } = status
    ? await pool.query('SELECT * FROM models WHERE status = $1 ORDER BY created_at DESC', [status])
    : await pool.query('SELECT * FROM models ORDER BY created_at DESC');
  res.json(rows);
}));

// Get one model
router.get('/:id', wrap(async (req, res) => {
  const { rows: [model] } = await pool.query('SELECT * FROM models WHERE id = $1', [req.params.id]);
  if (!model) return res.status(404).json({ error: 'Model not found' });
  res.json(model);
}));

// Register model
router.post('/', requirePermission('inference:manage'), wrap(async (req, res) => {
  const { name, version, endpoint, metadata_json } = req.body;
  if (!name || !version) return res.status(400).json({ error: 'name and version are required' });

  const { rows: [model] } = await pool.query(
    'INSERT INTO models (name, version, endpoint, metadata_json) VALUES ($1, $2, $3, $4) RETURNING *',
    [name, version, endpoint ?? null, metadata_json ?? null]
  );
  res.status(201).json(model);
}));

// Update status
router.patch('/:id/status', requirePermission('inference:manage'), wrap(async (req, res) => {
  const VALID = ['inactive', 'active', 'deprecated'];
  const { status } = req.body;
  if (!VALID.includes(status)) return res.status(400).json({ error: `status must be one of: ${VALID.join(', ')}` });

  const { rows: [model] } = await pool.query(
    'UPDATE models SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
    [status, req.params.id]
  );
  if (!model) return res.status(404).json({ error: 'Model not found' });
  res.json(model);
}));

export default router;
