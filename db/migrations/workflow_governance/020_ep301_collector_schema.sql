-- EP-301 — Automated Evidence Collectors: extend assurance_evidence
-- Makes workflow_id nullable so platform-level evidence (Kong, DB, n8n) can be
-- stored without binding to a specific workflow. Adds confidence hierarchy and
-- collector identity columns. Expands evidence_type CHECK to include four
-- platform collector types.

BEGIN;

-- Platform-level evidence has no single workflow association
ALTER TABLE workflow_governance.assurance_evidence
  ALTER COLUMN workflow_id DROP NOT NULL;

-- Confidence hierarchy: self_attested < system_collected < control_tested < independently_verified
ALTER TABLE workflow_governance.assurance_evidence
  ADD COLUMN IF NOT EXISTS confidence_level TEXT NOT NULL DEFAULT 'self_attested'
    CHECK (confidence_level IN (
      'self_attested',
      'system_collected',
      'control_tested',
      'independently_verified'
    ));

-- Who/what collected this evidence, and when the collector ran
ALTER TABLE workflow_governance.assurance_evidence
  ADD COLUMN IF NOT EXISTS collected_by  TEXT,
  ADD COLUMN IF NOT EXISTS collected_at  TIMESTAMPTZ;

-- Expand evidence_type to cover platform collector types
ALTER TABLE workflow_governance.assurance_evidence
  DROP CONSTRAINT IF EXISTS assurance_evidence_evidence_type_check;

ALTER TABLE workflow_governance.assurance_evidence
  ADD CONSTRAINT assurance_evidence_evidence_type_check
  CHECK (evidence_type IN (
    -- workflow-level (manual attestation)
    'workflow_export_verified',
    'database_backup_verified',
    'restore_test_passed',
    'credential_recovery_verified',
    'runbook_available',
    'manual_fallback_tested',
    'dependency_backup_verified',
    -- platform-level (automated collectors)
    'api_gateway_health',
    'database_health',
    'n8n_platform_health',
    'container_health'
  ));

-- Fast lookup for platform health dashboard (latest per type)
CREATE INDEX IF NOT EXISTS idx_assurance_platform
  ON workflow_governance.assurance_evidence (evidence_type, collected_at DESC)
  WHERE workflow_id IS NULL;

-- Filter + sort by confidence across all evidence
CREATE INDEX IF NOT EXISTS idx_assurance_confidence
  ON workflow_governance.assurance_evidence (confidence_level, collected_at DESC);

COMMIT;
