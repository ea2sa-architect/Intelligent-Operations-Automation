import { Router } from 'express';
import pool from '../db.js';

const router = Router();

router.post('/', async (req, res) => {
  const items = Array.isArray(req.body) ? req.body : [req.body];
  if (!items.length) return res.status(400).json({ error: 'At least one metric is required' });

  const invalid = items.find(m => !m.service_name || !m.metric_name || m.value === undefined);
  if (invalid) return res.status(400).json({ error: 'Each metric requires service_name, metric_name, and value' });

  try {
    const values = items.map((m, i) => {
      const base = i * 4;
      return `(COALESCE($${base + 1}::timestamptz, NOW()), $${base + 2}, $${base + 3}, $${base + 4})`;
    });
    const params = items.flatMap(m => [m.time || null, m.service_name, m.metric_name, m.value]);

    await pool.query(
      `INSERT INTO metrics (time, service_name, metric_name, value) VALUES ${values.join(', ')}`,
      params,
    );
    res.status(201).json({ inserted: items.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  const { service_name, metric_name, from, to, limit = 500 } = req.query;
  if (!from) return res.status(400).json({ error: 'from is required' });

  try {
    const conditions = [`time >= $1`, `time <= $2`];
    const params = [from, to || new Date().toISOString()];

    if (service_name) { params.push(service_name); conditions.push(`service_name = $${params.length}`); }
    if (metric_name) { params.push(metric_name); conditions.push(`metric_name = $${params.length}`); }

    params.push(Math.min(Number(limit), 5000));
    const { rows } = await pool.query(
      `SELECT * FROM metrics WHERE ${conditions.join(' AND ')} ORDER BY time DESC LIMIT $${params.length}`,
      params,
    );
    res.json({ data: rows, count: rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
