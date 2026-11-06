import { Router } from 'express';
import pool from '../../db.js';
import requireAuth, { requirePermission } from '../lib/require-auth.js';

const router = Router();
router.use(requireAuth);
const wrap = fn => (req, res) => fn(req, res).catch(err => res.status(500).json({ error: err.message }));

const MANUAL_EVIDENCE_TYPES = [
  'workflow_export_verified', 'database_backup_verified', 'restore_test_passed',
  'credential_recovery_verified', 'runbook_available', 'manual_fallback_tested',
  'dependency_backup_verified',
];
const STATUSES = ['verified', 'stale', 'failed', 'not_applicable'];
const CONFIDENCE_LEVELS = ['self_attested', 'system_collected', 'control_tested', 'independently_verified'];

// GET /assurance/platform — latest collector snapshot per evidence type
// Must be registered before /:workflow_id to avoid the wildcard swallowing it.
router.get('/platform', wrap(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (evidence_type) *
       FROM workflow_governance.assurance_evidence
      WHERE workflow_id IS NULL
      ORDER BY evidence_type, collected_at DESC NULLS LAST`
  );
  res.json(rows);
}));

// GET /assurance/:workflow_id — all recorded evidence for a workflow, most recent first
router.get('/:workflow_id', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM workflow_governance.assurance_evidence
      WHERE workflow_id = $1
      ORDER BY observed_at DESC`,
    [req.params.workflow_id]
  );
  res.json(rows);
}));

// POST /assurance — record a manual attestation
router.post('/', requirePermission('workflow:read'), wrap(async (req, res) => {
  const {
    workflow_id, evidence_type, source_system, status,
    evidence, observed_at, expires_at, verified_by,
    confidence_level,
  } = req.body;

  if (!workflow_id) return res.status(400).json({ error: 'workflow_id is required' });
  if (!MANUAL_EVIDENCE_TYPES.includes(evidence_type)) {
    return res.status(400).json({ error: `evidence_type must be one of: ${MANUAL_EVIDENCE_TYPES.join(', ')}` });
  }
  if (!STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${STATUSES.join(', ')}` });
  }
  if (!verified_by) return res.status(400).json({ error: 'verified_by is required' });
  if (confidence_level && !CONFIDENCE_LEVELS.includes(confidence_level)) {
    return res.status(400).json({ error: `confidence_level must be one of: ${CONFIDENCE_LEVELS.join(', ')}` });
  }

  const { rows: [record] } = await pool.query(
    `INSERT INTO workflow_governance.assurance_evidence
       (workflow_id, evidence_type, source_system, status, evidence,
        observed_at, expires_at, verified_by, confidence_level)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      workflow_id, evidence_type, source_system ?? null, status,
      evidence ? JSON.stringify(evidence) : null,
      observed_at ?? new Date().toISOString(), expires_at ?? null,
      verified_by,
      confidence_level ?? 'self_attested',
    ]
  );
  res.status(201).json(record);
}));

export default router;
