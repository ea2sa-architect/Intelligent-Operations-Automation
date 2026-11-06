-- Automation Trust Index (ATI): executive-facing composite, separate from the
-- engineering risk_score. Computed alongside risk_score at every scoring point.

ALTER TABLE workflow_governance.workflows
  ADD COLUMN IF NOT EXISTS ati_score          NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS ati_level          TEXT CHECK (ati_level IN ('LOW','MODERATE','HIGH','VERIFIED')),
  ADD COLUMN IF NOT EXISTS ati_breakdown_json JSONB;

CREATE INDEX IF NOT EXISTS idx_wf_ati_score ON workflow_governance.workflows(ati_score DESC NULLS LAST);
