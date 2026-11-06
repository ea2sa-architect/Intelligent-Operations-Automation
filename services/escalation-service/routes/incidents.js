import { Router } from 'express';
import pool from '../db.js';

const router = Router();

router.get('/', async (req, res) => {
  const { status, severity, limit = 20, offset = 0 } = req.query;
  try {
    const conditions = [];
    const params = [Number(limit), Number(offset)];
    if (status) { params.push(status); conditions.push(`status = $${params.length}`); }
    if (severity) { params.push(severity); conditions.push(`severity = $${params.length}`); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT * FROM incidents ${where} ORDER BY triggered_at DESC LIMIT $1 OFFSET $2`,
      params,
    );
    res.json({ data: rows, limit: Number(limit), offset: Number(offset) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const { rule_id, title, severity, context_json } = req.body;
  if (!title || !severity) return res.status(400).json({ error: 'title and severity are required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO incidents (rule_id, title, severity, context_json)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [rule_id, title, severity, context_json ? JSON.stringify(context_json) : null],
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM incidents WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Incident not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  const { status, context_json } = req.body;
  const now = new Date().toISOString();
  const acknowledged_at = status === 'acknowledged' ? now : null;
  const resolved_at = status === 'resolved' ? now : null;

  try {
    const { rows } = await pool.query(
      `UPDATE incidents
       SET status = COALESCE($1, status),
           context_json = COALESCE($2, context_json),
           acknowledged_at = CASE WHEN $1 = 'acknowledged' THEN NOW() ELSE acknowledged_at END,
           resolved_at = CASE WHEN $1 = 'resolved' THEN NOW() ELSE resolved_at END
       WHERE id = $3 RETURNING *`,
      [status, context_json ? JSON.stringify(context_json) : null, req.params.id],
    );
    if (!rows.length) return res.status(404).json({ error: 'Incident not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
