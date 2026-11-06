import { Router } from 'express';
import pool from '../db.js';

const router = Router();

router.get('/', async (req, res) => {
  const { enabled, severity, limit = 20, offset = 0 } = req.query;
  try {
    const conditions = [];
    const params = [Number(limit), Number(offset)];
    if (enabled !== undefined) { params.push(enabled === 'true'); conditions.push(`enabled = $${params.length}`); }
    if (severity) { params.push(severity); conditions.push(`severity = $${params.length}`); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT * FROM escalation_rules ${where} ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      params,
    );
    res.json({ data: rows, limit: Number(limit), offset: Number(offset) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const { name, condition_json, severity, channels_json = [], enabled = true } = req.body;
  if (!name || !condition_json || !severity) {
    return res.status(400).json({ error: 'name, condition_json and severity are required' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO escalation_rules (name, condition_json, severity, channels_json, enabled)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, JSON.stringify(condition_json), severity, JSON.stringify(channels_json), enabled],
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Rule name already exists' });
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM escalation_rules WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Rule not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  const { name, condition_json, severity, channels_json, enabled } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE escalation_rules
       SET name = COALESCE($1, name),
           condition_json = COALESCE($2, condition_json),
           severity = COALESCE($3, severity),
           channels_json = COALESCE($4, channels_json),
           enabled = COALESCE($5, enabled),
           updated_at = NOW()
       WHERE id = $6 RETURNING *`,
      [name, condition_json ? JSON.stringify(condition_json) : null,
       severity, channels_json ? JSON.stringify(channels_json) : null, enabled, req.params.id],
    );
    if (!rows.length) return res.status(404).json({ error: 'Rule not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM escalation_rules WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Rule not found' });
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
