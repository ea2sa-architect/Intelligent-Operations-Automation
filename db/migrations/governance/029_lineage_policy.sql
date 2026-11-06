-- EP-304 — Governance violations for data lineage findings.
-- Two rules: external_processor_detected (high) and cross_border_transfer (critical).

BEGIN;

DO $$
DECLARE
  v_policy_id UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM governance.policies WHERE name = 'Data Lineage') THEN
    RETURN;
  END IF;

  INSERT INTO governance.policies (name, status, enforcement_mode)
  VALUES ('Data Lineage', 'active', 'enforce')
  RETURNING id INTO v_policy_id;

  INSERT INTO governance.policy_rules
    (policy_id, condition_json, action, severity, enabled)
  VALUES
    (v_policy_id,
     '{"type":"external_processor_detected"}',
     'create_violation', 'high', true),
    (v_policy_id,
     '{"type":"cross_border_transfer"}',
     'create_violation', 'critical', true);
END;
$$;

COMMIT;
