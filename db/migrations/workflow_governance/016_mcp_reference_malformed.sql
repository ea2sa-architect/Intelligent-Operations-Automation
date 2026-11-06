-- Epic 2, Feature 2.1 — "malformed or unsupported MCP node definitions
-- reported so incomplete configurations can be investigated." Previously an
-- MCP-client node matched only by the generic /mcp/i type-name fallback (not
-- an exact known type), or one with no identifiable server-reference
-- parameter (falling back to the node's own name), was silently treated the
-- same as a fully well-formed reference.

ALTER TABLE workflow_governance.workflow_mcp_references
  ADD COLUMN IF NOT EXISTS malformed        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS malformed_reason TEXT;
