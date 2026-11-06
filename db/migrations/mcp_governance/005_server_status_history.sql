-- Epic 1, Feature 1.3 — status-change history and reject-reason. Mirrors the
-- "detected_at/resolved_at" audit-trail principle already used for
-- governance.violations, applied to MCP server lifecycle transitions
-- (pending_review -> approved/rejected/retired) so registration decisions
-- are traceable, not just the current status.

CREATE TABLE IF NOT EXISTS mcp_governance.mcp_server_status_history (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id    UUID        NOT NULL REFERENCES mcp_governance.mcp_servers(id) ON DELETE CASCADE,
  from_status  TEXT,
  to_status    TEXT        NOT NULL,
  reason       TEXT,
  changed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mcp_server_status_history_server
  ON mcp_governance.mcp_server_status_history(server_id, changed_at DESC);
