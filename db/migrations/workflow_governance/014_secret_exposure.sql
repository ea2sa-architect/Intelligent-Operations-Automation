-- Hardcoded-secret exposure findings. Mirrors workflow_pii_exposure's shape.
-- Only ever stores a redacted preview + fingerprint — never the raw secret value
-- (redaction happens in metadata-extractor.js before this table is ever written to).

CREATE TABLE IF NOT EXISTS workflow_governance.workflow_secret_exposure (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id         TEXT          NOT NULL REFERENCES workflow_governance.workflows(id) ON DELETE CASCADE,
  secret_type         TEXT          NOT NULL,
  node_name           TEXT,
  redacted_preview    TEXT          NOT NULL,
  fingerprint_sha256  TEXT          NOT NULL,
  discovered_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wfs_workflow ON workflow_governance.workflow_secret_exposure(workflow_id);
CREATE INDEX IF NOT EXISTS idx_wfs_type     ON workflow_governance.workflow_secret_exposure(secret_type);
