-- EP-305-S5/S6: Attack-path reachability graph per MCP server.
-- Computed from cross-schema queries against mcp_governance.mcp_servers,
-- mcp_governance.tool_definitions, and lineage_nodes.
-- Stored as computed JSONB (not a live graph) — rebuilt on demand.

CREATE TABLE IF NOT EXISTS workflow_governance.attack_paths (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  mcp_server_id         UUID        NOT NULL,
  server_name           TEXT        NOT NULL,
  reachable_tools       JSONB       NOT NULL DEFAULT '[]',
  external_destinations JSONB       NOT NULL DEFAULT '[]',
  cross_server_paths    JSONB       NOT NULL DEFAULT '[]',
  risk_factors          JSONB       NOT NULL DEFAULT '[]',
  risk_score            NUMERIC     NOT NULL DEFAULT 0,
  computed_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT attack_paths_server_id_key UNIQUE (mcp_server_id)
);

CREATE INDEX IF NOT EXISTS attack_paths_risk_score_idx ON workflow_governance.attack_paths (risk_score DESC);
