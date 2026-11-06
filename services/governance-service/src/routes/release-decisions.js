import { Router } from 'express';
import pool from '../../db.js';
import { requirePermission } from '../lib/require-auth.js';

const router = Router();
const wrap = fn => (req, res) => fn(req, res).catch(err => {
  console.error(err.message);
  res.status(500).json({ error: err.message });
});

// EP-311-P5 — Certify mode's decision. The server recomputes `decision`
// from real violation state rather than trusting the caller's own hint —
// mirrors /enforce's server-side authority over outcomes; the CLI's own
// decision_hint is UX, this is the governance rule.
//
// S2.10 (2026-10-08, finding F-06) — bySeverity used to come straight from
// the caller-supplied evidence_bundle.violations.by_severity, so a
// release:certify holder could submit a fabricated bundle claiming zero
// critical/high violations and get an automatic 'certified' decision
// regardless of the entity's actual violation state. Now re-queries
// governance.violations for the entity instead; the submitted bundle's
// violation counts are no longer consulted (policy_coverage.pct still is —
// that's supplementary context, not the input to this decision).
function computeDecision(bySeverity) {
  if ((bySeverity.critical ?? 0) > 0 || (bySeverity.high ?? 0) > 0) return 'rejected';
  return 'certified';
}

// Excludes 'resolved' (fixed) and 'waived_temporarily' (formally risk-
// accepted via the waiver flow, see EP-104) from the count — every other
// status (open, acknowledged, remediating, waiver_requested, reopened)
// still represents a live, unresolved finding against the entity.
async function fetchBySeverity(entityType, entityId) {
  const { rows } = await pool.query(
    `SELECT severity, count(*) AS count
       FROM governance.violations
      WHERE entity_type = $1 AND entity_id = $2
        AND status NOT IN ('resolved', 'waived_temporarily')
      GROUP BY severity`,
    [entityType, entityId]
  );
  return Object.fromEntries(rows.map(r => [r.severity, Number(r.count)]));
}

router.post('/', requirePermission('release:certify'), wrap(async (req, res) => {
  const { entity_type = 'workflow', entity_id, release_ref, evidence_bundle, decided_by, expiration } = req.body;
  if (!entity_id)    return res.status(400).json({ error: 'entity_id is required' });
  if (!evidence_bundle) return res.status(400).json({ error: 'evidence_bundle is required' });
  if (!decided_by)   return res.status(400).json({ error: 'decided_by is required' });

  const bySeverity = await fetchBySeverity(entity_type, entity_id);
  const decision = computeDecision(bySeverity);
  const coveragePct = evidence_bundle.policy_coverage?.pct ?? null;

  const { rows: [row] } = await pool.query(
    `INSERT INTO release_decisions
       (entity_type, entity_id, release_ref, decision, coverage_pct, evidence_bundle_json, decided_by, expiration)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [entity_type, entity_id, release_ref ?? null, decision, coveragePct, JSON.stringify(evidence_bundle), decided_by, expiration ?? null]
  );
  res.status(201).json(row);
}));

// GET /release-decisions?entity_type=&entity_id= — history, most recent first.
router.get('/', wrap(async (req, res) => {
  const { entity_type, entity_id } = req.query;
  const conditions = [];
  const params = [];
  if (entity_type) { params.push(entity_type); conditions.push(`entity_type = $${params.length}`); }
  if (entity_id)   { params.push(entity_id);   conditions.push(`entity_id = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT * FROM release_decisions ${where} ORDER BY created_at DESC`,
    params
  );
  res.json(rows);
}));

export default router;
