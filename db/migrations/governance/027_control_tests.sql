-- EP-302-S1/S2 — Control test registry and built-in test seeds
-- governance.control_tests: one row per named test, holds schedule + last result
-- governance.control_test_runs: append-only run history for trend/dashboard

BEGIN;

CREATE TABLE IF NOT EXISTS governance.control_tests (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT        NOT NULL UNIQUE,
  description         TEXT,
  test_type           TEXT        NOT NULL
    CHECK (test_type IN ('auth', 'telemetry', 'availability', 'configuration')),
  schedule_minutes    INT         NOT NULL DEFAULT 15,
  enabled             BOOLEAN     NOT NULL DEFAULT true,
  last_run_at         TIMESTAMPTZ,
  last_result         TEXT
    CHECK (last_result IN ('pass', 'fail', 'skipped', 'error')),
  last_evidence       JSONB,
  violation_rule_id   UUID        REFERENCES governance.policy_rules(id),
  violation_policy_id UUID        REFERENCES governance.policies(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS governance.control_test_runs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id     UUID        NOT NULL REFERENCES governance.control_tests(id) ON DELETE CASCADE,
  result      TEXT        NOT NULL
    CHECK (result IN ('pass', 'fail', 'skipped', 'error')),
  evidence    JSONB,
  duration_ms INT,
  ran_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_control_test_runs_test_id
  ON governance.control_test_runs (test_id, ran_at DESC);

-- Seed: Control Testing policy + rule, then the 4 built-in tests.
-- DO block makes it safe to re-run (idempotent via name UNIQUE + IF EXISTS guard).
DO $$
DECLARE
  v_policy_id UUID;
  v_rule_id   UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM governance.control_tests LIMIT 1) THEN
    RETURN;
  END IF;

  INSERT INTO governance.policies (name, status, enforcement_mode)
  VALUES ('Control Testing', 'active', 'enforce')
  ON CONFLICT (name) DO UPDATE SET status = EXCLUDED.status
  RETURNING id INTO v_policy_id;

  INSERT INTO governance.policy_rules
    (policy_id, condition_json, action, severity, enabled)
  VALUES
    (v_policy_id, '{"type":"control_test_failure"}', 'create_violation', 'critical', true)
  RETURNING id INTO v_rule_id;

  INSERT INTO governance.control_tests
    (name, description, test_type, schedule_minutes, violation_rule_id, violation_policy_id)
  VALUES
    ('unauthorized_call_blocked',
     'Auth middleware returns 401 for unauthenticated requests to governance API',
     'auth', 15, v_rule_id, v_policy_id),
    ('correlation_id_coverage',
     'All telemetry events in the last 24 h carry a correlation ID (EP-102)',
     'telemetry', 15, v_rule_id, v_policy_id),
    ('retired_server_blocked',
     'Retired/rejected MCP servers have no active routes in the Kong gateway',
     'availability', 15, v_rule_id, v_policy_id),
    ('rate_limiting_configured',
     'Rate-limiting plugins are active on at least one ioa-governance Kong route',
     'configuration', 15, v_rule_id, v_policy_id);
END;
$$;

COMMIT;
