-- Epic 2, Feature 2.2 — "ambiguous server matches reported for manual
-- resolution." Companion to 016's malformed columns: a reference that
-- normalizes to match more than one registered server is a distinct
-- condition from both "registered" and "unregistered".

ALTER TABLE workflow_governance.workflow_mcp_references
  ADD COLUMN IF NOT EXISTS ambiguous            BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ambiguous_candidates JSONB;
