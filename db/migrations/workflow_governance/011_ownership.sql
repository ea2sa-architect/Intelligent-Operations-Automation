-- Ownership signal: who is accountable for a workflow, and how confident we are
-- in that assignment (tag-derived vs. manually confirmed, and how stale).

ALTER TABLE workflow_governance.workflows
  ADD COLUMN IF NOT EXISTS technical_owner       TEXT,
  ADD COLUMN IF NOT EXISTS business_owner        TEXT,
  ADD COLUMN IF NOT EXISTS backup_owner          TEXT,
  ADD COLUMN IF NOT EXISTS owning_team           TEXT,
  ADD COLUMN IF NOT EXISTS escalation_contact    TEXT,
  ADD COLUMN IF NOT EXISTS ownership_source      TEXT CHECK (ownership_source IN ('tag', 'manual')),
  ADD COLUMN IF NOT EXISTS ownership_verified_at TIMESTAMPTZ;

-- Extend the governed tag registry to recognize an "ownership" role alongside
-- folder/governance/general, so admins can document owner:/team: tag conventions.
ALTER TABLE workflow_governance.tags
  DROP CONSTRAINT IF EXISTS tags_role_check;

ALTER TABLE workflow_governance.tags
  ADD CONSTRAINT tags_role_check
  CHECK (role IN ('folder', 'governance', 'general', 'ownership'));
