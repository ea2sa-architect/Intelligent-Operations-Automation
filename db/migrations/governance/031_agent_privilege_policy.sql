-- EP-204-F3 — Privilege escalation and confused-deputy detection are
-- system-detected security events, not user-configurable governance rules
-- (no admin ever builds one of these through the rule editor), but the
-- violations table's rule_id/policy_id are NOT NULL FKs into
-- governance.policy_rules/policies, and rule_type itself FKs into
-- rule_schemas — so, same as every other violation in this platform, these
-- two need a real (if minimal) catalog entry and a seeded policy to anchor
-- against. Both rule types are always forced to 'critical' severity at the
-- point of insertion (see agent-violation-recorder.js), not configurable
-- per-instance the way the elaborate rule_schemas in 005_rule_types.sql are.

INSERT INTO governance.rule_schemas (type, display_name, description, schema_json, ui_schema_json) VALUES
('agent_privilege_escalation', 'Agent Privilege Escalation',
  'An agent-issued credential attempted an action outside the permission scope its delegation record actually granted.',
  '{"fields": []}', '{"icon": "alert-triangle", "color": "red", "group": "agent_identity"}'),
('agent_confused_deputy', 'Agent Confused Deputy',
  'An agent acted using one principal''s delegated authority while the request identified a different principal as the beneficiary.',
  '{"fields": []}', '{"icon": "user-x", "color": "red", "group": "agent_identity"}')
ON CONFLICT (type) DO NOTHING;

INSERT INTO governance.policies (name, description, status, metadata_json)
VALUES (
  'Agent Delegation Boundary Enforcement',
  'Every agent-issued credential must stay inside the specific authority its delegation record granted — both in what it does (scope) and whose behalf it acts on (principal).',
  'active',
  '{"seeded": true, "rationale": "EP-204 gives every agent action a traceable delegation record (who initiated, what authority, what tool). This policy is what turns that traceability into an active control: exceeding the delegated scope or serving a different principal than the one who delegated is exactly the agent-identity risk EP-204-F3 exists to catch.", "remediation_guidance": "Investigate the flagged agent identity and its recent delegation records; revoke the agent (DELETE /agents/:id) if the pattern indicates compromise or misconfiguration rather than a one-off caller error."}'
) ON CONFLICT (name) DO NOTHING;

WITH p AS (SELECT id FROM governance.policies WHERE name = 'Agent Delegation Boundary Enforcement')
INSERT INTO governance.policy_rules (policy_id, rule_type, severity, config_json, enabled)
SELECT id, 'agent_privilege_escalation', 'critical', '{}', true FROM p
WHERE NOT EXISTS (
  SELECT 1 FROM governance.policy_rules WHERE policy_id = p.id AND rule_type = 'agent_privilege_escalation'
);

WITH p AS (SELECT id FROM governance.policies WHERE name = 'Agent Delegation Boundary Enforcement')
INSERT INTO governance.policy_rules (policy_id, rule_type, severity, config_json, enabled)
SELECT id, 'agent_confused_deputy', 'critical', '{}', true FROM p
WHERE NOT EXISTS (
  SELECT 1 FROM governance.policy_rules WHERE policy_id = p.id AND rule_type = 'agent_confused_deputy'
);
