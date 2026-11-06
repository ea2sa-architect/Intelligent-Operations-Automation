-- Epic 6, Features 6.3 and 6.4 — MCP Assurance Evidence and its lifecycle.
-- Kept as its own table in mcp_governance (not a generalization of
-- workflow_governance.assurance_evidence) because the two models genuinely
-- differ in shape: the workflow table records the OUTCOME of an automated
-- recoverability check (status: verified/stale/failed/not_applicable) with
-- no reviewer step, while this table records a REVIEW WORKFLOW for
-- evidence a human submits and another human validates or rejects
-- (status: collected/validated/rejected/expired/superseded) — forcing both
-- into one status enum would misrepresent one or the other. Every other
-- MCP-specific concept this session (credential exposure, decision history,
-- status history) was likewise kept in mcp_governance rather than written
-- cross-schema into workflow_governance, for the same service-ownership reason.

CREATE TABLE IF NOT EXISTS mcp_governance.mcp_assurance_evidence (
  id                      BIGSERIAL   PRIMARY KEY,
  server_id               UUID        NOT NULL REFERENCES mcp_governance.mcp_servers(id) ON DELETE CASCADE,
  evidence_type           TEXT        NOT NULL CHECK (evidence_type IN (
    'config_export', 'credential_rotation_verified',
    'authorization_revocation_tested', 'redeployment_recovery_tested'
  )),
  control_id              TEXT,
  policy_id               UUID,
  status                  TEXT        NOT NULL DEFAULT 'collected'
                            CHECK (status IN ('collected', 'validated', 'rejected', 'expired', 'superseded')),
  evidence                JSONB,
  source_system           TEXT,
  collection_method       TEXT,
  rejection_reason        TEXT,
  observed_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assessment_period_start TIMESTAMPTZ,
  assessment_period_end   TIMESTAMPTZ,
  expires_at              TIMESTAMPTZ,
  validated_by            TEXT,
  validated_at            TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mcp_assurance_evidence_server
  ON mcp_governance.mcp_assurance_evidence(server_id, evidence_type);

-- Fast lookup for the trust-ceiling condition: "this server's validated
-- evidence has expired."
CREATE INDEX IF NOT EXISTS idx_mcp_assurance_evidence_expiring
  ON mcp_governance.mcp_assurance_evidence(server_id, expires_at)
  WHERE status = 'validated';
