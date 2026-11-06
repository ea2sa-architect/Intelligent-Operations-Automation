// EP-305 — Behavioral anomaly detection: baselines + alerts.
// Literal sub-paths registered before /:workflow_id wildcard.

import { Router } from 'express'
import pool from '../../db.js'
import { computeBaseline, scoreExecution } from '../lib/baseline-engine.js'
import requireAuth, { requirePermission } from '../lib/require-auth.js'

const router = Router()
// EP-308-S4 — this router had no auth at all (unlike tags.js/assurance.js's
// router-level requireAuth); SPA-facing only, no external callers, same
// justification as those routers for a single router-level check.
router.use(requireAuth)
const wrap   = fn => (req, res) => fn(req, res).catch(err => {
  console.error('[anomaly]', err.message)
  res.status(500).json({ error: err.message })
})

// ── GET /anomaly/baselines ─────────────────────────────────────────────────
router.get('/baselines', wrap(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT b.*, w.name AS workflow_name
    FROM behavior_baselines b
    LEFT JOIN workflows w ON w.id = b.workflow_id
    ORDER BY b.computed_at DESC
  `)
  res.json(rows)
}))

// ── POST /anomaly/baselines/:workflow_id/compute ───────────────────────────
router.post('/baselines/:workflow_id/compute', requirePermission('workflow:read'), wrap(async (req, res) => {
  const baseline = await computeBaseline(req.params.workflow_id)
  if (!baseline) return res.status(404).json({ error: 'No telemetry data found for this workflow in the last 30 days' })
  res.json(baseline)
}))

// ── GET /anomaly/baselines/:workflow_id ───────────────────────────────────
router.get('/baselines/:workflow_id', wrap(async (req, res) => {
  const { rows: [row] } = await pool.query(
    'SELECT * FROM behavior_baselines WHERE workflow_id = $1',
    [req.params.workflow_id]
  )
  if (!row) return res.status(404).json({ error: 'No baseline for this workflow' })
  res.json(row)
}))

// ── GET /anomaly/alerts ────────────────────────────────────────────────────
router.get('/alerts', wrap(async (req, res) => {
  const { workflow_id, status, alert_type, limit = 100 } = req.query
  const conditions = []
  const params     = []

  if (workflow_id)  conditions.push(`a.workflow_id  = $${params.push(workflow_id)}`)
  if (status)       conditions.push(`a.status       = $${params.push(status)}`)
  if (alert_type)   conditions.push(`a.alert_type   = $${params.push(alert_type)}`)

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  params.push(Math.min(Number(limit), 500))

  const { rows } = await pool.query(`
    SELECT a.*, w.name AS workflow_name
    FROM anomaly_alerts a
    LEFT JOIN workflows w ON w.id = a.workflow_id
    ${where}
    ORDER BY a.created_at DESC
    LIMIT $${params.length}
  `, params)
  res.json(rows)
}))

// ── PATCH /anomaly/alerts/:id ──────────────────────────────────────────────
router.patch('/alerts/:id', requirePermission('workflow:read'), wrap(async (req, res) => {
  const { status } = req.body
  const VALID = ['open','acknowledged','resolved']
  if (!VALID.includes(status)) return res.status(400).json({ error: `status must be one of: ${VALID.join(', ')}` })

  const { rows: [row] } = await pool.query(
    `UPDATE anomaly_alerts SET status = $1 WHERE id = $2 RETURNING *`,
    [status, req.params.id]
  )
  if (!row) return res.status(404).json({ error: 'Alert not found' })
  res.json(row)
}))

// ── POST /anomaly/score (internal — called by lineage-builder) ─────────────
router.post('/score', requirePermission('workflow:read'), wrap(async (req, res) => {
  const { correlation_id } = req.body
  if (!correlation_id) return res.status(400).json({ error: 'correlation_id required' })
  const alerts = await scoreExecution(correlation_id)
  res.json({ correlation_id, alerts_fired: alerts.length, alerts })
}))

// ── GET /anomaly/summary ───────────────────────────────────────────────────
router.get('/summary', wrap(async (req, res) => {
  const { rows: [counts] } = await pool.query(`
    SELECT
      COUNT(*)                                              ::int AS total,
      COUNT(*) FILTER (WHERE status = 'open')              ::int AS open,
      COUNT(*) FILTER (WHERE severity = 'critical')        ::int AS critical,
      COUNT(*) FILTER (WHERE severity = 'high')            ::int AS high,
      COUNT(*) FILTER (WHERE alert_type = 'unexpected_tool')::int AS unexpected_tool,
      COUNT(*) FILTER (WHERE alert_type = 'new_destination')::int AS new_destination,
      COUNT(*) FILTER (WHERE alert_type = 'latency_spike') ::int AS latency_spike,
      COUNT(*) FILTER (WHERE alert_type = 'excessive_loop')::int AS excessive_loop
    FROM anomaly_alerts
  `)
  const { rows: [baselines] } = await pool.query(
    'SELECT COUNT(*)::int AS count FROM behavior_baselines'
  )
  res.json({ alerts: counts, baselines: baselines.count })
}))

export default router
