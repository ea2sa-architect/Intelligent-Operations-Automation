-- Persists MCP server risk scores computed by mcp-risk-scorer.js.
-- Mirrors workflow_governance.workflows' risk_score/risk_level/risk_breakdown_json/
-- scored_at pattern.

ALTER TABLE mcp_governance.mcp_servers
  ADD COLUMN IF NOT EXISTS risk_score          NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS risk_level           TEXT CHECK (risk_level IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  ADD COLUMN IF NOT EXISTS risk_breakdown_json  JSONB,
  ADD COLUMN IF NOT EXISTS scored_at            TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_mcp_servers_risk_score ON mcp_governance.mcp_servers(risk_score DESC NULLS LAST);
