-- Tracks MCP-client nodes discovered inside workflows and whether the MCP
-- server they reference is registered in mcp_governance.mcp_servers.
-- No cross-schema FK (services stay HTTP-coupled, not DB-coupled — mirrors
-- how governance.violations references workflow_id without an FK across
-- schemas) — mcp_server_id is resolved via mcp-governance-service's API
-- and stored here as a plain reference.

CREATE TABLE IF NOT EXISTS workflow_governance.workflow_mcp_references (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id      TEXT          NOT NULL REFERENCES workflow_governance.workflows(id) ON DELETE CASCADE,
  node_name        TEXT,
  server_reference TEXT          NOT NULL,
  mcp_server_id    UUID,
  mcp_server_name  TEXT,
  registered       BOOLEAN       NOT NULL DEFAULT false,
  discovered_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wmr_workflow    ON workflow_governance.workflow_mcp_references(workflow_id);
CREATE INDEX IF NOT EXISTS idx_wmr_unregistered ON workflow_governance.workflow_mcp_references(registered) WHERE NOT registered;

-- Add mcp_client as a recognized node governance_type (metadata-extractor.js
-- now classifies MCP-client nodes this way instead of leaving them 'unknown').
ALTER TABLE workflow_governance.workflow_nodes
  DROP CONSTRAINT IF EXISTS workflow_nodes_governance_type_check;

ALTER TABLE workflow_governance.workflow_nodes
  ADD CONSTRAINT workflow_nodes_governance_type_check
  CHECK (governance_type IN (
    'ai_inference','http','database','approval','logic',
    'transform','storage','notification','schedule','webhook','credential',
    'mcp_client','unknown'
  ));
