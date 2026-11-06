-- EP-103-S1 — append-only history of every violation status transition
-- (open → acknowledged → resolved → waived → reopened, manual or
-- automatic). policy_version is a snapshot of governance.policies.version
-- at the time of the change — the policy itself may be edited/versioned
-- later, so this preserves what was actually in effect. evidence_id is a
-- loose reference (no FK — no single evidence table spans schemas, same
-- convention as mcp-governance's cross-schema references elsewhere).

CREATE TABLE IF NOT EXISTS governance.violation_history (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  violation_id   UUID        NOT NULL REFERENCES governance.violations(id) ON DELETE CASCADE,
  prev_status    TEXT,
  new_status     TEXT        NOT NULL,
  actor          TEXT        NOT NULL,
  reason         TEXT,
  policy_version INT,
  evidence_id    UUID,
  changed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_violation_history_violation ON governance.violation_history(violation_id, changed_at DESC);
