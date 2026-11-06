-- EP-311-P6 — Controlled execution testing is a governed capability, not a
-- CLI flag: a workflow can only be exercised with real input once a human
-- has reviewed and approved a specific set of test scenarios for it, same
-- trust model as approval_chains/waivers elsewhere on this platform. One
-- approved profile at a time per workflow (idx_tep_one_approved_per_workflow).

CREATE TABLE IF NOT EXISTS workflow_governance.test_execution_profiles (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id       TEXT        NOT NULL REFERENCES workflow_governance.workflows(id) ON DELETE CASCADE,
  webhook_node_name TEXT        NOT NULL,
  scenarios_json    JSONB       NOT NULL DEFAULT '[]',
  status            TEXT        NOT NULL CHECK (status IN ('pending_review','approved','rejected','expired','revoked')) DEFAULT 'pending_review',
  requested_by      TEXT        NOT NULL,
  approved_by       TEXT,
  approved_at       TIMESTAMPTZ,
  rejection_reason  TEXT,
  expiration        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tep_workflow ON workflow_governance.test_execution_profiles(workflow_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tep_one_approved_per_workflow
  ON workflow_governance.test_execution_profiles(workflow_id) WHERE status = 'approved';
