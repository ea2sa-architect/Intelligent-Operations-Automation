-- Epic 3, Features 3.1 and 3.2 — classification-override reasons and
-- approval/deny reasons, both as a single decision-audit-trail table (a
-- tool has two independently-changeable governance decisions: its risk
-- classification and its approval status). "Original classification" per
-- Feature 3.1's story is derivable from this table (earliest
-- decision_type='classification' row) rather than a redundant column.

CREATE TABLE IF NOT EXISTS mcp_governance.mcp_tool_decision_history (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_id       UUID        NOT NULL REFERENCES mcp_governance.mcp_tools(id) ON DELETE CASCADE,
  decision_type TEXT        NOT NULL CHECK (decision_type IN ('classification', 'approval')),
  from_value    TEXT,
  to_value      TEXT        NOT NULL,
  reason        TEXT,
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mcp_tool_decision_history_tool
  ON mcp_governance.mcp_tool_decision_history(tool_id, changed_at DESC);
