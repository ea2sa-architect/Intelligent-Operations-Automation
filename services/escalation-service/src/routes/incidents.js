import { Router } from 'express';
import pool from '../../db.js';
import { requirePermission } from '../lib/require-auth.js';

const router = Router();
const wrap = fn => (req, res) => fn(req, res).catch(err => {
  console.error(err.message);
  res.status(500).json({ error: err.message });
});

const TRANSITIONS = {
  open:         ['acknowledged', 'resolved', 'closed'],
  acknowledged: ['resolved', 'closed'],
  resolved:     ['closed'],
  closed:       [],
};

// List incidents
router.get('/', wrap(async (req, res) => {
  const { status, severity, limit = 50, offset = 0 } = req.query;
  const conditions = [];
  const params = [];

  if (status)   { conditions.push(`status = $${params.push(status)}`); }
  if (severity) { conditions.push(`severity = $${params.push(severity)}`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(Number(limit), Number(offset));
  const { rows } = await pool.query(
    `SELECT * FROM incidents ${where} ORDER BY triggered_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  res.json(rows);
}));

// Get incident with notification log
router.get('/:id', wrap(async (req, res) => {
  const { rows: [incident] } = await pool.query('SELECT * FROM incidents WHERE id = $1', [req.params.id]);
  if (!incident) return res.status(404).json({ error: 'Incident not found' });

  const { rows: log } = await pool.query(
    'SELECT * FROM escalation_log WHERE incident_id = $1 ORDER BY created_at',
    [req.params.id]
  );
  res.json({ ...incident, log });
}));

// Trigger incident
router.post('/', requirePermission('incident:manage'), wrap(async (req, res) => {
  const { rule_id, title, severity, context_json } = req.body;
  if (!title || !severity) return res.status(400).json({ error: 'title and severity are required' });

  const { rows: [incident] } = await pool.query(
    'INSERT INTO incidents (rule_id, title, severity, context_json) VALUES ($1, $2, $3, $4) RETURNING *',
    [rule_id ?? null, title, severity, context_json ?? null]
  );
  res.status(201).json(incident);
}));

// Transition incident status
router.patch('/:id/status', requirePermission('incident:manage'), wrap(async (req, res) => {
  const { status } = req.body;
  const { rows: [current] } = await pool.query('SELECT status FROM incidents WHERE id = $1', [req.params.id]);
  if (!current) return res.status(404).json({ error: 'Incident not found' });

  const allowed = TRANSITIONS[current.status] ?? [];
  if (!allowed.includes(status)) {
    return res.status(409).json({ error: `Cannot transition from '${current.status}' to '${status}'` });
  }

  const timestamps = {
    acknowledged: ', acknowledged_at = NOW()',
    resolved:     ', resolved_at = NOW()',
    closed:       '',
  };

  const { rows: [incident] } = await pool.query(
    `UPDATE incidents SET status = $1${timestamps[status] ?? ''} WHERE id = $2 RETURNING *`,
    [status, req.params.id]
  );
  res.json(incident);
}));

// Log a notification against an incident
router.post('/:id/log', requirePermission('incident:manage'), wrap(async (req, res) => {
  const { channel, recipient, message_json, status = 'sent' } = req.body;
  if (!channel || !recipient) return res.status(400).json({ error: 'channel and recipient are required' });

  const { rows: [entry] } = await pool.query(
    `INSERT INTO escalation_log (incident_id, channel, recipient, message_json, status, sent_at)
     VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *`,
    [req.params.id, channel, recipient, message_json ?? null, status]
  );
  res.status(201).json(entry);
}));

export default router;
