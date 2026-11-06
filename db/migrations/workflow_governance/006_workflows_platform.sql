-- Add platform-agnostic columns to workflows table.
-- platform_connection_id links to the registered integration that sourced the workflow.
-- source_id is the native ID in that platform (Zap ID, Scenario ID, Flow ID, n8n workflow ID).
-- n8n_id is kept for backward compatibility with existing records.

ALTER TABLE workflow_governance.workflows
  ADD COLUMN IF NOT EXISTS platform               TEXT NOT NULL DEFAULT 'n8n',
  ADD COLUMN IF NOT EXISTS platform_connection_id UUID REFERENCES workflow_governance.platform_connections(id)
                                                  ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_id              TEXT;

-- Backfill existing n8n records so source_id is always populated
UPDATE workflow_governance.workflows
  SET source_id = n8n_id
  WHERE source_id IS NULL AND n8n_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wf_platform ON workflow_governance.workflows(platform);
CREATE INDEX IF NOT EXISTS idx_wf_conn     ON workflow_governance.workflows(platform_connection_id);
