import { Router } from 'express';
import pool from '../../db.js';
import requireAuth from '../lib/require-auth.js';

const router = Router();
// AUTH-201 (extended) — this router is entirely SPA-facing, no external
// (n8n) callers, so a single router-level requireAuth is sufficient.
router.use(requireAuth);
const wrap = fn => (req, res) => fn(req, res).catch(err => res.status(500).json({ error: err.message }));

// ── GET /risk/summary ──────────────────────────────────────────────────────
// Aggregate risk dashboard: distribution, top offenders, PII stats
router.get('/summary', wrap(async (_req, res) => {
  const [totals, distribution, topRisk, piiStats, secretStats] = await Promise.all([
    pool.query(`
      SELECT
        COUNT(*)::int                                              AS total_workflows,
        COUNT(*) FILTER (WHERE active)::int                        AS active_workflows,
        COUNT(*) FILTER (WHERE risk_score IS NOT NULL)::int        AS scored_workflows,
        COUNT(*) FILTER (WHERE policies_applied)::int              AS policies_applied,
        ROUND(AVG(risk_score)::numeric, 2)                         AS avg_risk_score
      FROM workflow_governance.workflows
    `),
    pool.query(`
      SELECT risk_level, COUNT(*)::int AS count
      FROM workflow_governance.workflows
      WHERE risk_level IS NOT NULL
      GROUP BY risk_level
      ORDER BY
        CASE risk_level
          WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2
          WHEN 'MEDIUM' THEN 3   ELSE 4
        END
    `),
    pool.query(`
      SELECT id, name, risk_score, risk_level, top_factors
      FROM (
        SELECT id, name, risk_score, risk_level,
               risk_breakdown_json->'top_risk_factors' AS top_factors
        FROM workflow_governance.workflows
        WHERE risk_score IS NOT NULL
        ORDER BY risk_score DESC
        LIMIT 5
      ) t
    `),
    pool.query(`
      SELECT pii_type, COUNT(DISTINCT workflow_id)::int AS workflow_count,
             SUM(CASE WHEN NOT masked THEN 1 ELSE 0 END)::int AS unmasked_count
      FROM workflow_governance.workflow_pii_exposure
      GROUP BY pii_type
      ORDER BY workflow_count DESC
    `),
    pool.query(`
      SELECT secret_type, COUNT(DISTINCT workflow_id)::int AS workflow_count
      FROM workflow_governance.workflow_secret_exposure
      GROUP BY secret_type
      ORDER BY workflow_count DESC
    `),
  ]);

  res.json({
    ...totals.rows[0],
    risk_distribution: distribution.rows,
    top_risk_workflows: topRisk.rows,
    pii_exposure_summary: piiStats.rows,
    secret_exposure_summary: secretStats.rows,
    generated_at: new Date().toISOString(),
  });
}));

// ── GET /risk/pii/:pii_type ────────────────────────────────────────────────
// All workflows exposing a specific PII type, with per-workflow node details
router.get('/pii/:pii_type', wrap(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT
      w.id, w.name, w.risk_level, w.risk_score, w.platform,
      p.node_name, p.field_location, p.masked, p.encrypted
    FROM workflow_governance.workflow_pii_exposure p
    JOIN workflow_governance.workflows w ON w.id = p.workflow_id
    WHERE p.pii_type = $1
    ORDER BY w.risk_score DESC NULLS LAST, w.name
  `, [req.params.pii_type]);
  res.json(rows);
}));

// ── GET /risk/secrets/:secret_type ─────────────────────────────────────────
// All workflows with a hardcoded secret of this type. Only the redacted
// preview + fingerprint are ever returned — never the raw secret value.
router.get('/secrets/:secret_type', wrap(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT
      w.id, w.name, w.risk_level, w.risk_score, w.platform,
      s.node_name, s.redacted_preview, s.fingerprint_sha256, s.discovered_at
    FROM workflow_governance.workflow_secret_exposure s
    JOIN workflow_governance.workflows w ON w.id = s.workflow_id
    WHERE s.secret_type = $1
    ORDER BY w.risk_score DESC NULLS LAST, w.name
  `, [req.params.secret_type]);
  res.json(rows);
}));

// ── GET /risk/nodes ────────────────────────────────────────────────────────
// Aggregate view of high-risk node types across all workflows
router.get('/nodes', wrap(async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT
      governance_type,
      COUNT(*)::int                          AS total_nodes,
      COUNT(DISTINCT workflow_id)::int        AS workflow_count,
      ARRAY_AGG(DISTINCT unnested_factor)
        FILTER (WHERE unnested_factor IS NOT NULL) AS common_risk_factors
    FROM workflow_governance.workflow_nodes
    CROSS JOIN UNNEST(risk_factors) AS unnested_factor
    GROUP BY governance_type
    ORDER BY total_nodes DESC
  `);
  res.json(rows);
}));

// ── GET /risk/by-domain ────────────────────────────────────────────────────
// Risk rollup grouped by business_domain (classification-only field — see
// tag-attributes.js). Until business classification is populated, everything
// groups under "Unclassified" — still functional.
router.get('/by-domain', wrap(async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT
      COALESCE(business_domain, 'Unclassified')          AS business_domain,
      COUNT(*)::int                                       AS total_workflows,
      COUNT(*) FILTER (WHERE risk_level IN ('HIGH','CRITICAL'))::int AS high_risk_workflows,
      ROUND(AVG(risk_score)::numeric, 2)                  AS avg_risk_score
    FROM workflow_governance.workflows
    GROUP BY COALESCE(business_domain, 'Unclassified')
    ORDER BY avg_risk_score DESC NULLS LAST
  `);
  res.json(rows);
}));

export default router;
