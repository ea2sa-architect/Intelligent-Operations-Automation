import { Router } from 'express';
import pool from '../../db.js';

const router = Router();
const wrap = fn => (req, res) => fn(req, res).catch(err => {
  console.error(err.message);
  res.status(500).json({ error: err.message });
});

// List all rule type definitions
router.get('/', wrap(async (_req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM rule_schemas ORDER BY display_name'
  );
  res.json(rows);
}));

// Get a single rule schema by type
router.get('/:type', wrap(async (req, res) => {
  const { rows: [schema] } = await pool.query(
    'SELECT * FROM rule_schemas WHERE type = $1',
    [req.params.type]
  );
  if (!schema) return res.status(404).json({ error: 'Rule schema not found' });
  res.json(schema);
}));

export default router;
