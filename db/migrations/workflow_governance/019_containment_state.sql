-- EP-203-S1 — same containment concept as mcp_governance's servers/tools
-- (migration 015 in that schema); see that file's header for the rationale.
ALTER TABLE workflow_governance.workflows
  ADD COLUMN IF NOT EXISTS containment_state TEXT NOT NULL DEFAULT 'active'
    CHECK (containment_state IN ('active', 'suspended', 'quarantined', 'read_only'));
