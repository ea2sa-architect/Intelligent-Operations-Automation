-- Epic 3, Feature 3.3 — "inspect the previous and current tool definitions
-- before reapproval" and "tool-definition changes recorded as governance
-- events". Snapshots the OLD definition whenever drift is detected (PUT
-- /tools/:id, before the row is overwritten) — current is always just the
-- live mcp_tools row, so only the previous state needs to be retained here.

CREATE TABLE IF NOT EXISTS mcp_governance.mcp_tool_definition_history (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_id             UUID        NOT NULL REFERENCES mcp_governance.mcp_tools(id) ON DELETE CASCADE,
  description         TEXT,
  input_schema_json   JSONB,
  output_schema_json  JSONB,
  definition_hash     TEXT        NOT NULL,
  version             TEXT,
  superseded_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mcp_tool_definition_history_tool
  ON mcp_governance.mcp_tool_definition_history(tool_id, superseded_at DESC);
