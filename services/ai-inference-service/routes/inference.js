import { Router } from 'express';
import pool from '../db.js';

const router = Router();

router.get('/', async (req, res) => {
  const { model_id, status, limit = 20, offset = 0 } = req.query;
  try {
    const conditions = [];
    const params = [];
    if (model_id) conditions.push(`model_id = $${params.push(model_id)}`);
    if (status) conditions.push(`status = $${params.push(status)}`);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limitPos = params.push(Number(limit));
    const offsetPos = params.push(Number(offset));
    const { rows } = await pool.query(
      `SELECT * FROM inference_requests ${where} ORDER BY created_at DESC LIMIT $${limitPos} OFFSET $${offsetPos}`,
      params,
    );
    res.json({ data: rows, limit: Number(limit), offset: Number(offset) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const { model_id, input_hash, output_json, latency_ms, status = 'pending', error_message } = req.body;
  if (!model_id || !input_hash) return res.status(400).json({ error: 'model_id and input_hash are required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO inference_requests (model_id, input_hash, output_json, latency_ms, status, error_message)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [model_id, input_hash, output_json ? JSON.stringify(output_json) : null, latency_ms, status, error_message],
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23503') return res.status(400).json({ error: 'model_id references a model that does not exist' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  const { status, output_json, latency_ms, error_message } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE inference_requests
       SET status = COALESCE($1, status),
           output_json = COALESCE($2, output_json),
           latency_ms = COALESCE($3, latency_ms),
           error_message = COALESCE($4, error_message)
       WHERE id = $5 RETURNING *`,
      [status, output_json ? JSON.stringify(output_json) : null, latency_ms, error_message, req.params.id],
    );
    if (!rows.length) return res.status(404).json({ error: 'Inference request not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const reqResult = await pool.query(
      'SELECT * FROM inference_requests WHERE id = $1',
      [req.params.id],
    );
    if (!reqResult.rows.length) return res.status(404).json({ error: 'Inference request not found' });

    const decResult = await pool.query(
      'SELECT * FROM decisions WHERE inference_request_id = $1 ORDER BY created_at',
      [req.params.id],
    );
    res.json({ ...reqResult.rows[0], decisions: decResult.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/decisions', async (req, res) => {
  const { policy_id, outcome, confidence, reasoning_json } = req.body;
  if (!outcome) return res.status(400).json({ error: 'outcome is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO decisions (inference_request_id, policy_id, outcome, confidence, reasoning_json)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.params.id, policy_id, outcome, confidence, reasoning_json ? JSON.stringify(reasoning_json) : null],
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
