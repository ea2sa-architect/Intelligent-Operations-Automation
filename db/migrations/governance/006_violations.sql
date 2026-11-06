-- Violation engine: runtime findings from rule evaluation against workflows
CREATE TABLE IF NOT EXISTS governance.violations (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id TEXT        NOT NULL,
  rule_id     UUID        NOT NULL REFERENCES governance.policy_rules(id) ON DELETE CASCADE,
  policy_id   UUID        NOT NULL REFERENCES governance.policies(id)     ON DELETE CASCADE,
  severity    TEXT        NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  message     TEXT,
  status      TEXT        NOT NULL DEFAULT 'open'
                CHECK (status IN ('open', 'acknowledged', 'resolved')),
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_violations_workflow
  ON governance.violations(workflow_id);

CREATE INDEX IF NOT EXISTS idx_violations_policy
  ON governance.violations(policy_id);

CREATE INDEX IF NOT EXISTS idx_violations_rule
  ON governance.violations(rule_id);

-- Partial index for fast open-violation queries (the common dashboard case)
CREATE INDEX IF NOT EXISTS idx_violations_open
  ON governance.violations(workflow_id, detected_at DESC)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_violations_severity
  ON governance.violations(severity, status);
