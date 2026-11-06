import { Router } from 'express';
import pool from '../../db.js';
import requireAuth from '../lib/require-auth.js';

const router = Router();
// AUTH-201 (extended) — this router is entirely SPA-facing, no external
// (n8n) callers, so a single router-level requireAuth is sufficient.
router.use(requireAuth);
const wrap = fn => (req, res) => fn(req, res).catch(err => res.status(500).json({ error: err.message }));

// ── GET /trust/summary ─────────────────────────────────────────────────────
// Platform-wide Automation Trust Index rollup for the executive dashboard.
router.get('/summary', wrap(async (_req, res) => {
  const [totals, distribution] = await Promise.all([
    pool.query(`
      SELECT
        COUNT(*)::int                                       AS total_workflows,
        COUNT(*) FILTER (WHERE ati_score IS NOT NULL)::int  AS scored_workflows,
        COUNT(*) FILTER (WHERE ati_breakdown_json->>'provisional' = 'true')::int AS provisional_workflows,
        ROUND(AVG(ati_score)::numeric, 2)                   AS avg_ati_score
      FROM workflow_governance.workflows
    `),
    pool.query(`
      SELECT ati_level, COUNT(*)::int AS count
      FROM workflow_governance.workflows
      WHERE ati_level IS NOT NULL
      GROUP BY ati_level
      ORDER BY
        CASE ati_level
          WHEN 'LOW' THEN 1 WHEN 'MODERATE' THEN 2
          WHEN 'HIGH' THEN 3 ELSE 4
        END
    `),
  ]);

  res.json({
    ...totals.rows[0],
    ati_distribution: distribution.rows,
    generated_at: new Date().toISOString(),
  });
}));

// ── GET /trust/by-domain ────────────────────────────────────────────────────
// ATI rollup grouped by business_domain. Until business classification (tags/
// fields) is populated, everything groups under "Unclassified" — still functional.
router.get('/by-domain', wrap(async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT
      COALESCE(business_domain, 'Unclassified')          AS business_domain,
      COUNT(*)::int                                       AS total_workflows,
      ROUND(AVG(ati_score)::numeric, 2)                   AS avg_ati_score,
      ROUND(AVG(risk_score)::numeric, 2)                  AS avg_risk_score
    FROM workflow_governance.workflows
    GROUP BY COALESCE(business_domain, 'Unclassified')
    ORDER BY avg_ati_score ASC NULLS LAST
  `);
  res.json(rows);
}));

export default router;
