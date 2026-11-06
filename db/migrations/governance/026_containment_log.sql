-- EP-203-S2 — the platform-wide, append-only containment audit trail.
-- Mirrors approval_decision_history's role for approvals: governance-service
-- is the one place every containment action across every asset type gets
-- recorded, even though the actual containment_state column lives on each
-- asset's own table in its own service/schema (mcp_governance.mcp_servers/
-- mcp_tools, workflow_governance.workflows) — same split as
-- enforcement_events (log here) vs. the policy/violation state it describes
-- (lives with the asset).
CREATE TABLE IF NOT EXISTS governance.containment_log (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_type TEXT        NOT NULL,
  asset_id   TEXT        NOT NULL,
  action     TEXT        NOT NULL CHECK (action IN ('suspend', 'quarantine', 'restore', 'read_only', 'rollback')),
  actor      TEXT        NOT NULL,
  reason     TEXT,
  detail_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_containment_log_asset ON governance.containment_log(asset_type, asset_id);
CREATE INDEX IF NOT EXISTS idx_containment_log_created_at ON governance.containment_log(created_at);

-- Append-only, same trigger function as violation_history/approval_decision_history.
DROP TRIGGER IF EXISTS containment_log_no_update ON governance.containment_log;
CREATE TRIGGER containment_log_no_update
  BEFORE UPDATE ON governance.containment_log
  FOR EACH ROW EXECUTE FUNCTION governance.prevent_history_mutation();

DROP TRIGGER IF EXISTS containment_log_no_delete ON governance.containment_log;
CREATE TRIGGER containment_log_no_delete
  BEFORE DELETE ON governance.containment_log
  FOR EACH ROW EXECUTE FUNCTION governance.prevent_history_mutation();
