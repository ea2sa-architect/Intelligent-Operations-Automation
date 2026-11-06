import { Router } from 'express';
import pool from '../db.js';

const router = Router();

router.get('/', async (req, res) => {
  const { status, limit = 20, offset = 0 } = req.query;
  try {
    const params = [Number(limit), Number(offset)];
    const where = status ? 'WHERE status = $3' : '';
    if (status) params.push(status);
    const { rows } = await pool.query(
      `SELECT * FROM models ${where} ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      params,
    );
    res.json({ data: rows, limit: Number(limit), offset: Number(offset) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const { name, version, endpoint, status = 'inactive', metadata_json } = req.body;
  if (!name || !version) return res.status(400).json({ error: 'name and version are required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO models (name, version, endpoint, status, metadata_json)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, version, endpoint, status, metadata_json ? JSON.stringify(metadata_json) : null],
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Model name+version already exists' });
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM models WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Model not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  const { name, version, endpoint, status, metadata_json } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE models
       SET name = COALESCE($1, name), version = COALESCE($2, version),
           endpoint = COALESCE($3, endpoint), status = COALESCE($4, status),
           metadata_json = COALESCE($5, metadata_json), updated_at = NOW()
       WHERE id = $6 RETURNING *`,
      [name, version, endpoint, status, metadata_json ? JSON.stringify(metadata_json) : null, req.params.id],
    );
    if (!rows.length) return res.status(404).json({ error: 'Model not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
