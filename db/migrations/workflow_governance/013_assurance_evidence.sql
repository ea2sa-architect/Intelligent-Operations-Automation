-- Recoverability evidence: manual attestation (v1 has no external backup/restore
-- system integration — a human records what was verified and when).

CREATE TABLE IF NOT EXISTS workflow_governance.assurance_evidence (
  id             BIGSERIAL   PRIMARY KEY,
  workflow_id    TEXT        NOT NULL REFERENCES workflow_governance.workflows(id) ON DELETE CASCADE,
  evidence_type  TEXT        NOT NULL CHECK (evidence_type IN (
    'workflow_export_verified', 'database_backup_verified', 'restore_test_passed',
    'credential_recovery_verified', 'runbook_available', 'manual_fallback_tested',
    'dependency_backup_verified'
  )),
  source_system  TEXT,
  status         TEXT        NOT NULL CHECK (status IN ('verified', 'stale', 'failed', 'not_applicable')),
  evidence       JSONB,
  observed_at    TIMESTAMPTZ NOT NULL,
  expires_at     TIMESTAMPTZ,
  verified_by    TEXT        NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assurance_workflow ON workflow_governance.assurance_evidence(workflow_id, evidence_type);
