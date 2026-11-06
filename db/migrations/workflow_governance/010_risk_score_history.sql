-- Append-only risk-score history: one row per distinct scoring result, so risk
-- trends, before/after remediation, and scoring-model version comparisons are
-- all answerable from real data instead of the single overwritten current score.

CREATE TABLE IF NOT EXISTS workflow_governance.workflow_risk_score_history (
  id                        BIGSERIAL   PRIMARY KEY,
  workflow_id               TEXT        NOT NULL REFERENCES workflow_governance.workflows(id) ON DELETE CASCADE,
  platform                  TEXT        NOT NULL,
  overall_score             NUMERIC(5,2) NOT NULL,
  risk_level                TEXT        NOT NULL,
  dimension_scores          JSONB       NOT NULL,
  finding_count             INTEGER     NOT NULL DEFAULT 0,
  scoring_version           TEXT        NOT NULL,
  workflow_definition_hash  TEXT        NOT NULL,
  scored_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_risk_history_workflow_time
  ON workflow_governance.workflow_risk_score_history (workflow_id, scored_at DESC);
