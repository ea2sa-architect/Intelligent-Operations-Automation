// EP-305-S5/S6/S7 — Attack-path reachability routes.
// Literal sub-paths (/rebuild, /summary) registered before /:mcp_server_id wildcard.

import { Router } from 'express'
import pool from '../../db.js'
import { buildAttackPath, buildAllAttackPaths } from '../lib/attack-path-builder.js'
import requireAuth, { requirePermission } from '../lib/require-auth.js'

const router = Router()
// EP-308-S4 — this router had no auth at all; SPA-facing only, same
// justification as tags.js/assurance.js for a single router-level check.
router.use(requireAuth)
const wrap   = fn => (req, res) => fn(req, res).catch(err => {
  console.error('[attack-paths]', err.message)
  res.status(500).json({ error: err.message })
})

// ── GET /attack-paths ──────────────────────────────────────────────────────
router.get('/', wrap(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT * FROM attack_paths ORDER BY risk_score DESC, computed_at DESC
  `)
  res.json(rows)
}))

// ── POST /attack-paths/rebuild ─────────────────────────────────────────────
router.post('/rebuild', requirePermission('workflow:read'), wrap(async (req, res) => {
  const results = await buildAllAttackPaths()
  res.json({ rebuilt: results.length, results })
}))

// ── GET /attack-paths/summary ──────────────────────────────────────────────
router.get('/summary', wrap(async (req, res) => {
  const { rows: [row] } = await pool.query(`
    SELECT
      COUNT(*)                                          ::int AS total,
      COUNT(*) FILTER (WHERE risk_score >= 75)          ::int AS critical_risk,
      COUNT(*) FILTER (WHERE risk_score >= 50 AND risk_score < 75)::int AS high_risk,
      ROUND(AVG(risk_score)::numeric, 1)                      AS avg_risk_score,
      MAX(risk_score)                                         AS max_risk_score
    FROM attack_paths
  `)
  res.json(row)
}))

// ── GET /attack-paths/:mcp_server_id ──────────────────────────────────────
router.get('/:mcp_server_id', wrap(async (req, res) => {
  const { rows: [row] } = await pool.query(
    'SELECT * FROM attack_paths WHERE mcp_server_id = $1',
    [req.params.mcp_server_id]
  )
  if (!row) return res.status(404).json({ error: 'No attack path computed for this server — try POST /rebuild/:mcp_server_id' })
  res.json(row)
}))

// ── POST /attack-paths/rebuild/:mcp_server_id ─────────────────────────────
router.post('/rebuild/:mcp_server_id', requirePermission('workflow:read'), wrap(async (req, res) => {
  const result = await buildAttackPath(req.params.mcp_server_id)
  if (!result) return res.status(404).json({ error: 'MCP server not found' })
  res.json(result)
}))

export default router
