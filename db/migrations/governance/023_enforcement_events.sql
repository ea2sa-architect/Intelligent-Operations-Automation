-- EP-201-S10 — one row per policy per /enforce call, in every mode
-- (including 'observe'). This is what makes the vertical slice's first
-- promise real: "record every resulting governance decision" starts working
-- the moment /enforce exists, before Kong or n8n ever call it, and before
-- anyone flips a policy out of 'observe'. violation_id is nullable — an
-- 'allow' outcome (rules passed clean) has no violation to point at.
CREATE TABLE IF NOT EXISTS governance.enforcement_events (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id      UUID        NOT NULL REFERENCES governance.policies(id) ON DELETE CASCADE,
  violation_id   UUID        REFERENCES governance.violations(id) ON DELETE SET NULL,
  asset_type     TEXT        NOT NULL,
  asset_id       TEXT        NOT NULL,
  mode           TEXT        NOT NULL CHECK (mode IN ('observe', 'warn', 'enforce')),
  outcome        TEXT        NOT NULL CHECK (outcome IN ('allow', 'warn', 'block')),
  message        TEXT,
  correlation_id TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_enforcement_events_policy_id ON governance.enforcement_events(policy_id);
CREATE INDEX IF NOT EXISTS idx_enforcement_events_asset ON governance.enforcement_events(asset_type, asset_id);
CREATE INDEX IF NOT EXISTS idx_enforcement_events_created_at ON governance.enforcement_events(created_at);
CREATE INDEX IF NOT EXISTS idx_enforcement_events_correlation_id ON governance.enforcement_events(correlation_id) WHERE correlation_id IS NOT NULL;

-- EP-201-S10 is explicitly an event log, not a governed record — no
-- append-only trigger here (contrast migration 018). Unlike violations, an
-- enforcement event has no lifecycle to protect; it's a fact about what
-- happened at one moment, never updated after the fact.
