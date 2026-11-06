import { Router } from 'express';
import pool from '../../db.js';
import { requirePermission } from '../lib/require-auth.js';

const router = Router();
const wrap = fn => (req, res) => fn(req, res).catch(err => res.status(500).json({ error: err.message }));

const EVIDENCE_TYPES = [
  'config_export', 'credential_rotation_verified',
  'authorization_revocation_tested', 'redeployment_recovery_tested',
];
const STATUSES = ['collected', 'validated', 'rejected', 'expired', 'superseded'];

// POST /servers/:serverId/assurance-evidence — Epic 6, Feature 6.3. Starts
// life as 'collected' — submitting evidence is not the same as it being
// trusted; a reviewer must validate it (Feature 6.4).
router.post('/servers/:serverId/assurance-evidence', requirePermission('waiver:grant'), wrap(async (req, res) => {
  const {
    evidence_type, control_id, policy_id, evidence, source_system, collection_method,
    observed_at, assessment_period_start, assessment_period_end, expires_at,
  } = req.body;

  if (!EVIDENCE_TYPES.includes(evidence_type)) {
    return res.status(400).json({ error: `evidence_type must be one of: ${EVIDENCE_TYPES.join(', ')}` });
  }

  const { rows: [row] } = await pool.query(
    `INSERT INTO mcp_governance.mcp_assurance_evidence
       (server_id, evidence_type, control_id, policy_id, evidence, source_system, collection_method,
        observed_at, assessment_period_start, assessment_period_end, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      req.params.serverId, evidence_type, control_id ?? null, policy_id ?? null,
      evidence ? JSON.stringify(evidence) : null, source_system ?? null, collection_method ?? null,
      observed_at ?? new Date(), assessment_period_start ?? null, assessment_period_end ?? null, expires_at ?? null,
    ]
  );
  res.status(201).json(row);
}));

// GET /servers/:serverId/assurance-evidence — Feature 6.3's "expired or
// stale assurance evidence identified" via ?stale=true (validated evidence
// whose expiration has passed but the reaper hasn't swept it yet, plus
// anything already flipped to 'expired').
router.get('/servers/:serverId/assurance-evidence', wrap(async (req, res) => {
  const { stale } = req.query;
  const params = [req.params.serverId];
  const staleClause = stale === 'true'
    ? `AND (status = 'expired' OR (status = 'validated' AND expires_at IS NOT NULL AND expires_at < NOW()))`
    : '';

  const { rows } = await pool.query(
    `SELECT * FROM mcp_governance.mcp_assurance_evidence
      WHERE server_id = $1 ${staleClause}
      ORDER BY observed_at DESC`,
    params
  );
  res.json(rows);
}));

// PATCH /assurance-evidence/:id/status — validate or reject. Feature 6.4:
// rejection requires a reason; validating a piece of evidence automatically
// supersedes the previously-validated evidence of the same type on the same
// server (retained for historical review, not deleted).
router.patch('/assurance-evidence/:id/status', requirePermission('waiver:grant'), wrap(async (req, res) => {
  const { status, rejection_reason } = req.body;
  if (!STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${STATUSES.join(', ')}` });
  }
  if (status === 'rejected' && !rejection_reason) {
    return res.status(400).json({ error: 'rejection_reason is required when rejecting evidence' });
  }

  const { rows: [existing] } = await pool.query(
    'SELECT server_id, evidence_type FROM mcp_governance.mcp_assurance_evidence WHERE id = $1',
    [req.params.id]
  );
  if (!existing) return res.status(404).json({ error: 'Assurance evidence not found' });

  const { rows: [row] } = await pool.query(
    `UPDATE mcp_governance.mcp_assurance_evidence
        SET status = $1,
            rejection_reason = CASE WHEN $1 = 'rejected' THEN $2 ELSE rejection_reason END,
            validated_by = CASE WHEN $1 = 'validated' THEN $3 ELSE validated_by END,
            validated_at = CASE WHEN $1 = 'validated' THEN NOW() ELSE validated_at END
      WHERE id = $4
      RETURNING *`,
    [status, rejection_reason ?? null, req.body.validated_by ?? null, req.params.id]
  );

  if (status === 'validated') {
    await pool.query(
      `UPDATE mcp_governance.mcp_assurance_evidence
          SET status = 'superseded'
        WHERE server_id = $1 AND evidence_type = $2 AND status = 'validated' AND id != $3`,
      [existing.server_id, existing.evidence_type, req.params.id]
    );
  }

  res.json(row);
}));

export default router;
