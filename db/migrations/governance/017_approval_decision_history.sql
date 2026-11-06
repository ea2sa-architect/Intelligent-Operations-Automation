-- EP-103-S2 — central, append-only log of approval/rejection decisions
-- across asset types (mcp_server, mcp_tool, mcp_prompt, and future asset
-- types as the platform grows). asset_type/asset_id is a loose polymorphic
-- reference (no FK — the assets live in a different schema/service), same
-- convention as mcp-governance's own cross-schema references. Written to by
-- mcp-governance-service's approval routes via a cross-service call
-- alongside those services' own local history tables (mcp_server_status_history,
-- mcp_tool_decision_history), which remain the operational/UI source for
-- per-asset detail views — this is the platform-wide audit trail.

CREATE TABLE IF NOT EXISTS governance.approval_decision_history (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_type          TEXT        NOT NULL,
  asset_id            TEXT        NOT NULL,
  decision            TEXT        NOT NULL,
  actor               TEXT        NOT NULL,
  role                TEXT,
  supporting_evidence TEXT,
  expiration          TIMESTAMPTZ,
  decided_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_approval_decision_history_asset ON governance.approval_decision_history(asset_type, asset_id, decided_at DESC);
