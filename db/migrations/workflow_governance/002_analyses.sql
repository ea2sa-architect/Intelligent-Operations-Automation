-- Async AI governance analysis jobs for imported/discovered workflows

CREATE TABLE IF NOT EXISTS workflow_governance.workflow_analyses (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id  TEXT        NOT NULL REFERENCES workflow_governance.workflows(id) ON DELETE CASCADE,
  status       TEXT        NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','completed','failed')),
  prompt_json  JSONB       NOT NULL DEFAULT '{}',
  analysis     TEXT,
  error        TEXT,
  retry_count  INT         NOT NULL DEFAULT 0,
  max_retries  INT         NOT NULL DEFAULT 2,
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '5 minutes',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Lookup jobs by workflow (list all analyses for a workflow)
CREATE INDEX IF NOT EXISTS idx_wa_workflow ON workflow_governance.workflow_analyses(workflow_id, created_at DESC);

-- Reaper: efficient scan for expired pending jobs
CREATE INDEX IF NOT EXISTS idx_wa_pending_expires
  ON workflow_governance.workflow_analyses(expires_at)
  WHERE status = 'pending';

-- Status filter for admin queries
CREATE INDEX IF NOT EXISTS idx_wa_status ON workflow_governance.workflow_analyses(status);
