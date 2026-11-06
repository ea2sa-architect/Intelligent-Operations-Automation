-- Business classification: reporting/filtering context only (deliberately not a
-- risk-scorer.js input) — enables "risk by business domain" and feeds the
-- Automation Trust Index's mission-critical ceiling rule via `criticality`.

ALTER TABLE workflow_governance.workflows
  ADD COLUMN IF NOT EXISTS business_domain           TEXT,
  ADD COLUMN IF NOT EXISTS business_capability        TEXT,
  ADD COLUMN IF NOT EXISTS criticality                TEXT
    CHECK (criticality IN ('low', 'moderate', 'high', 'mission_critical')),
  ADD COLUMN IF NOT EXISTS data_classification        TEXT,
  ADD COLUMN IF NOT EXISTS customer_impact            BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS financial_impact           BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS maximum_tolerable_downtime INTERVAL,
  ADD COLUMN IF NOT EXISTS manual_fallback_available  BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_wf_business_domain ON workflow_governance.workflows(business_domain);
CREATE INDEX IF NOT EXISTS idx_wf_criticality     ON workflow_governance.workflows(criticality);
