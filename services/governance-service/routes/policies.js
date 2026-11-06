import { Router } from 'express';
import pool from '../db.js';

const router = Router();

router.get('/', async (req, res) => {
  const { status, limit = 20, offset = 0 } = req.query;
  try {
    const params = [Number(limit), Number(offset)];
    const where = status ? `WHERE status = $3` : '';
    if (status) params.push(status);
    const { rows } = await pool.query(
      `SELECT * FROM policies ${where} ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      params,
    );
    res.json({ data: rows, limit: Number(limit), offset: Number(offset) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const { name, description, status = 'draft' } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO policies (name, description, status) VALUES ($1, $2, $3) RETURNING *',
      [name, description, status],
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Policy name already exists' });
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM policies WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Policy not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  const { name, description, status } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE policies
       SET name = COALESCE($1, name), description = COALESCE($2, description),
           status = COALESCE($3, status), updated_at = NOW()
       WHERE id = $4 RETURNING *`,
      [name, description, status, req.params.id],
    );
    if (!rows.length) return res.status(404).json({ error: 'Policy not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM policies WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Policy not found' });
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/rules', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM policy_rules WHERE policy_id = $1 ORDER BY priority',
      [req.params.id],
    );
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/rules', async (req, res) => {
  const { condition_json, action, priority = 0 } = req.body;
  if (!condition_json || !action) return res.status(400).json({ error: 'condition_json and action are required' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO policy_rules (policy_id, condition_json, action, priority) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.params.id, condition_json, action, priority],
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id/rules/:ruleId', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM policy_rules WHERE id = $1 AND policy_id = $2',
      [req.params.ruleId, req.params.id],
    );
    if (!rowCount) return res.status(404).json({ error: 'Rule not found' });
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/bindings', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM policy_bindings WHERE policy_id = $1 ORDER BY created_at DESC',
      [req.params.id],
    );
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/bindings', async (req, res) => {
  const { entity_type, entity_id, effective_from, effective_to } = req.body;
  if (!entity_type || !entity_id) return res.status(400).json({ error: 'entity_type and entity_id are required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO policy_bindings (policy_id, entity_type, entity_id, effective_from, effective_to)
       VALUES ($1, $2, $3, COALESCE($4::timestamptz, NOW()), $5) RETURNING *`,
      [req.params.id, entity_type, entity_id, effective_from, effective_to],
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Binding already exists' });
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id/bindings/:bindingId', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM policy_bindings WHERE id = $1 AND policy_id = $2',
      [req.params.bindingId, req.params.id],
    );
    if (!rowCount) return res.status(404).json({ error: 'Binding not found' });
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
