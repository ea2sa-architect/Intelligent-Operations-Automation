-- Add project columns to workflows (n8n Projects feature: top-level folder separation)
ALTER TABLE workflow_governance.workflows
  ADD COLUMN IF NOT EXISTS project_id   TEXT,
  ADD COLUMN IF NOT EXISTS project_name TEXT;

CREATE INDEX IF NOT EXISTS idx_wf_project_id
  ON workflow_governance.workflows(project_id)
  WHERE project_id IS NOT NULL;
