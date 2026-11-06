-- Epic 5, Feature 5.3 — Credential Exposure Detection. Mirrors
-- workflow_governance.workflow_secret_exposure's shape (redacted preview +
-- fingerprint only, never the raw match) but scoped to MCP server config
-- fields and resource URI templates rather than n8n node parameters.

CREATE TABLE IF NOT EXISTS mcp_governance.mcp_credential_exposure (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id          UUID        NOT NULL REFERENCES mcp_governance.mcp_servers(id) ON DELETE CASCADE,
  source_type        TEXT        NOT NULL CHECK (source_type IN ('server_config', 'resource_uri')),
  field_name         TEXT        NOT NULL,
  resource_id        UUID        REFERENCES mcp_governance.mcp_resources(id) ON DELETE CASCADE,
  secret_type        TEXT        NOT NULL,
  redacted_preview   TEXT        NOT NULL,
  fingerprint_sha256 TEXT        NOT NULL,
  detected_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mcp_credential_exposure_server
  ON mcp_governance.mcp_credential_exposure(server_id);
