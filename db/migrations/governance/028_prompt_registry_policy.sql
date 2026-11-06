-- EP-303 — Governance policy and rule for prompt drift violations.
-- Seeds exactly once (guarded by name uniqueness).

BEGIN;

DO $$
DECLARE
  v_policy_id UUID;
  v_rule_id   UUID;
BEGIN
  IF EXISTS (
    SELECT 1 FROM governance.policies WHERE name = 'Prompt Registry'
  ) THEN
    RETURN;
  END IF;

  INSERT INTO governance.policies (name, status, enforcement_mode)
  VALUES ('Prompt Registry', 'active', 'enforce')
  RETURNING id INTO v_policy_id;

  INSERT INTO governance.policy_rules
    (policy_id, condition_json, action, severity, enabled)
  VALUES
    (v_policy_id, '{"type":"prompt_drift"}', 'create_violation', 'high', true)
  RETURNING id INTO v_rule_id;
END;
$$;

COMMIT;
