import { Router } from 'express';
import pool from '../../db.js';
import { requirePermission } from '../lib/require-auth.js';

const router = Router();
const wrap = fn => (req, res) => fn(req, res).catch(err => {
  console.error(err.message);
  res.status(500).json({ error: err.message });
});

// Record an audit event
// S2.9 (2026-10-08, finding F-04) — actor_id/actor_type are trusted as given
// ONLY for service-key callers, which are themselves the accountable party
// (e.g. auth-service's audit-client.js already derives these correctly from
// the human user it authenticated). A human session holding audit:write
// (platform-admin/admin — see permissions.js) previously could claim ANY
// actor performed ANY action in this append-only log with no cross-check;
// now it's forced to their own identity.
router.post('/', requirePermission('audit:write'), wrap(async (req, res) => {
  const { event_type, resource_type, resource_id, action, outcome, metadata_json } = req.body;
  const actor_id   = req.user?.isService ? req.body.actor_id   : req.user?.id;
  const actor_type = req.user?.isService ? req.body.actor_type : 'user';
  const required = { event_type, actor_id, actor_type, resource_type, resource_id, action, outcome };
  const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });

  const { rows: [event] } = await pool.query(
    `INSERT INTO audit_events
       (event_type, actor_id, actor_type, resource_type, resource_id, action, outcome, metadata_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [event_type, actor_id, actor_type, resource_type, resource_id, action, outcome, metadata_json ?? null]
  );
  res.status(201).json(event);
}));

// Query audit events
router.get('/', wrap(async (req, res) => {
  const { actor_id, actor_type, resource_type, resource_id, event_type, outcome, from, to, limit = 100, offset = 0 } = req.query;
  const conditions = [];
  const params = [];

  if (actor_id)      { conditions.push(`actor_id = $${params.push(actor_id)}`); }
  if (actor_type)    { conditions.push(`actor_type = $${params.push(actor_type)}`); }
  if (resource_type) { conditions.push(`resource_type = $${params.push(resource_type)}`); }
  if (resource_id)   { conditions.push(`resource_id = $${params.push(resource_id)}`); }
  if (event_type)    { conditions.push(`event_type = $${params.push(event_type)}`); }
  if (outcome)       { conditions.push(`outcome = $${params.push(outcome)}`); }
  if (from)          { conditions.push(`created_at >= $${params.push(from)}`); }
  if (to)            { conditions.push(`created_at <= $${params.push(to)}`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(Math.min(Number(limit), 500), Number(offset));

  const { rows } = await pool.query(
    `SELECT * FROM audit_events ${where} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  res.json(rows);
}));

// ── GET /audit/export ──────────────────────────────────────────────────────
// On-demand backup of the audit log — downloads events as JSON, optionally
// scoped by from/to. Nothing in this platform deletes audit events today,
// so this is an archive/backup convenience rather than a pre-delete safety
// net (compare workflow-governance-service's GET /workflows/export, which
// exists specifically because DELETE /workflows does delete). "/export" as
// a literal first segment so it isn't shadowed by GET /:id below.
// Gated on audit:read — unlike the ungated GET / and GET /:id above, a bulk
// unbounded dump of the whole log is sensitive enough to warrant it.
router.get('/export', requirePermission('audit:read'), wrap(async (req, res) => {
  const { from, to } = req.query;
  const conditions = [];
  const params = [];
  if (from) conditions.push(`created_at >= $${params.push(from)}`);
  if (to)   conditions.push(`created_at <= $${params.push(to)}`);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT * FROM audit_events ${where} ORDER BY created_at ASC`,
    params
  );
  const exportedAt = new Date().toISOString();
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="ioa-audit-backup-${exportedAt.slice(0, 10)}.json"`
  );
  res.json({ exported_at: exportedAt, from: from ?? null, to: to ?? null, count: rows.length, events: rows });
}));

// Get single event
router.get('/:id', wrap(async (req, res) => {
  const { rows: [event] } = await pool.query(
    'SELECT * FROM audit_events WHERE id = $1', [req.params.id]
  );
  if (!event) return res.status(404).json({ error: 'Event not found' });
  res.json(event);
}));

export default router;
