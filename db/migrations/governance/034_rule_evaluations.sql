-- EP-311-P0 — coverage instrumentation: one current-knowledge row per
-- (entity, rule) answering "was this rule ever evaluated against this
-- entity, and what did it find last time" — not a growing log (violations
-- and enforcement_events already are that); a policy-coverage metric needs
-- a cheap upserted fact, not a history scan.

CREATE TABLE IF NOT EXISTS governance.rule_evaluations (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type  TEXT        NOT NULL,
  entity_id    TEXT        NOT NULL,
  rule_id      UUID        NOT NULL REFERENCES governance.policy_rules(id) ON DELETE CASCADE,
  policy_id    UUID        NOT NULL REFERENCES governance.policies(id) ON DELETE CASCADE,
  last_result  TEXT        NOT NULL CHECK (last_result IN ('clean', 'violation')),
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT rule_evaluations_entity_rule_key UNIQUE (entity_type, entity_id, rule_id)
);

CREATE INDEX IF NOT EXISTS idx_rule_evaluations_entity ON governance.rule_evaluations(entity_type, entity_id);
