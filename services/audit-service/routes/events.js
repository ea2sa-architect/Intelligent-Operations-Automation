import { Router } from 'express';
import pool from '../db.js';

const router = Router();

router.get('/', async (req, res) => {
  const { event_type, actor_id, actor_type, resource_type, resource_id, outcome, from, to, limit = 50, offset = 0 } = req.query;
  try {
    const conditions = [];
    const params = [];

    if (event_type) { params.push(event_type); conditions.push(`event_type = $${params.length}`); }
    if (actor_id) { params.push(actor_id); conditions.push(`actor_id = $${params.length}`); }
    if (actor_type) { params.push(actor_type); conditions.push(`actor_type = $${params.length}`); }
    if (resource_type) { params.push(resource_type); conditions.push(`resource_type = $${params.length}`); }
    if (resource_id) { params.push(resource_id); conditions.push(`resource_id = $${params.length}`); }
    if (outcome) { params.push(outcome); conditions.push(`outcome = $${params.length}`); }
    if (from) { params.push(from); conditions.push(`created_at >= $${params.length}`); }
    if (to) { params.push(to); conditions.push(`created_at <= $${params.length}`); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(Number(limit), Number(offset));

    const { rows } = await pool.query(
      `SELECT * FROM audit_events ${where} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    res.json({ data: rows, limit: Number(limit), offset: Number(offset) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const { event_type, actor_id, actor_type, resource_type, resource_id, action, outcome, metadata_json } = req.body;
  const required = { event_type, actor_id, actor_type, resource_type, resource_id, action, outcome };
  const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });

  try {
    const { rows } = await pool.query(
      `INSERT INTO audit_events (event_type, actor_id, actor_type, resource_type, resource_id, action, outcome, metadata_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [event_type, actor_id, actor_type, resource_type, resource_id, action, outcome,
       metadata_json ? JSON.stringify(metadata_json) : null],
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
