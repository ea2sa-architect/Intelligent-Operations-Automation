-- Generalizes violations from workflow-only to any governed entity type
-- (starting with MCP servers/tools in the MCP Governance epic). Additive and
-- backward-compatible: workflow_id stays populated for workflow violations
-- exactly as before — existing workflow_id-based queries keep working
-- unchanged. New entity types (e.g. 'mcp_server') use entity_type/entity_id
-- instead and leave workflow_id NULL.

ALTER TABLE governance.violations
  ALTER COLUMN workflow_id DROP NOT NULL;

ALTER TABLE governance.violations
  ADD COLUMN IF NOT EXISTS entity_type TEXT NOT NULL DEFAULT 'workflow',
  ADD COLUMN IF NOT EXISTS entity_id   TEXT;

-- Backfill existing rows so entity_id always mirrors workflow_id for the
-- violations that already exist.
UPDATE governance.violations
   SET entity_id = workflow_id
 WHERE entity_id IS NULL;

ALTER TABLE governance.violations
  ALTER COLUMN entity_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_violations_entity
  ON governance.violations(entity_type, entity_id);
