-- EP-305: Behavioral Anomaly Detection policy + rules.
-- Guards against inserting duplicate policy/rules if migration re-runs.

DO $$
DECLARE
  v_policy_id UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM governance.policies WHERE name = 'Behavioral Anomaly') THEN
    RETURN;
  END IF;

  INSERT INTO governance.policies (name, description, status)
  VALUES (
    'Behavioral Anomaly',
    'Detects deviations from established workflow execution baselines and maps attack-path exposure across MCP servers.',
    'active'
  )
  RETURNING id INTO v_policy_id;

  INSERT INTO governance.policy_rules (policy_id, condition_json, action, severity, enabled) VALUES
    (v_policy_id, '{"type":"unexpected_tool"}',  'create_violation', 'high',     true),
    (v_policy_id, '{"type":"excessive_loop"}',   'create_violation', 'high',     true),
    (v_policy_id, '{"type":"new_destination"}',  'create_violation', 'high',     true),
    (v_policy_id, '{"type":"latency_spike"}',    'create_violation', 'medium',   true),
    (v_policy_id, '{"type":"excessive_scope"}',  'create_violation', 'high',     true),
    (v_policy_id, '{"type":"pii_egress"}',       'create_violation', 'critical', true);
END $$;
