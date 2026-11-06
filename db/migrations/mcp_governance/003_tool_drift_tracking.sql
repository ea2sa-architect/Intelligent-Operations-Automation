-- Records when a tool's definition hash last changed after having been
-- previously approved, so "unreviewed drift" (approval_status = 'pending'
-- AND last_drift_detected_at IS NOT NULL) is queryable rather than
-- indistinguishable from a brand-new, never-reviewed tool. Feeds the
-- Feature 5.2 MCP trust-ceiling rule.

ALTER TABLE mcp_governance.mcp_tools
  ADD COLUMN IF NOT EXISTS last_drift_detected_at TIMESTAMPTZ;
