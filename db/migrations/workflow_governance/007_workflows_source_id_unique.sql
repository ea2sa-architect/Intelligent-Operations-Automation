-- Partial unique index enabling ON CONFLICT upserts for non-n8n platform workflows.
-- n8n workflows continue to use the existing UNIQUE constraint on n8n_id.
-- Make.com, Zapier, and Power Automate imports use (platform, source_id) for deduplication.

CREATE UNIQUE INDEX IF NOT EXISTS idx_workflows_platform_source_id
  ON workflow_governance.workflows(platform, source_id)
  WHERE platform != 'n8n' AND source_id IS NOT NULL;
