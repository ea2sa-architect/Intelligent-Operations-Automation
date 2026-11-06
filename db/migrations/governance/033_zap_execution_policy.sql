-- Zapier -> IOA enforcement (proof-of-concept direction). Zapier has no
-- registry of "zaps" in IOA the way mcp_servers or ai_inference.models do —
-- a Zap calling POST /enforce just passes its own name/id as asset_id, with
-- optional context (trigger app, action app). Same auto-bind-on-first-
-- evaluation shape as EP-201-F5's ai_model_governance
-- (032_ai_model_governance_policy.sql): one seeded policy, no per-Zap
-- registration step required before the first call gets a real decision.

INSERT INTO governance.rule_schemas (type, display_name, description, schema_json, ui_schema_json) VALUES
('zap_execution_governance', 'Zap Execution Governance',
  'Blocks or warns on Zap executions by name/id, or by trigger/action app, reported via Zapier''s IOA-issued enforcement credential.',
  '{"fields": [
    {"name": "blocked_zap_ids", "type": "json_array", "label": "Blocked Zap Names/IDs",
     "placeholder": "e.g. legacy-payment-sync, shadow-crm-export"},
    {"name": "blocked_apps", "type": "json_array", "label": "Blocked Trigger/Action Apps",
     "placeholder": "e.g. dropbox, google_sheets"},
    {"name": "severity", "type": "severity", "label": "Severity", "required": true,
     "options": ["low", "medium", "high", "critical"]}
  ]}',
  '{"icon": "zap", "color": "orange", "group": "ai_governance"}'
) ON CONFLICT (type) DO NOTHING;

INSERT INTO governance.policies (name, description, status, metadata_json)
VALUES (
  'Zapier Zap Execution Governance',
  'Every Zap execution reported through a Zapier enforcement credential is checked against this policy before Zapier proceeds down its allow/deny/escalate Path. Defaults to observe (record-only) until deliberately promoted, same as every other seeded policy.',
  'active',
  '{"seeded": true, "rationale": "Zapier -> IOA is the proof-of-concept direction (IOA-issued credential, Zapier calls POST /enforce directly) chosen over IOA -> Zapier OAuth discovery because it needs no Zapier Workflow API access and can ship immediately. OAuth-based Zap discovery/import is a separate, later phase.", "remediation_guidance": "Add the Zap name/id to blocked_zap_ids, or the trigger/action app to blocked_apps, then promote this policy to warn or enforce mode from Governance > Policies."}'
) ON CONFLICT (name) DO NOTHING;

WITH p AS (SELECT id FROM governance.policies WHERE name = 'Zapier Zap Execution Governance')
INSERT INTO governance.policy_rules (policy_id, rule_type, severity, config_json, enabled)
SELECT id, 'zap_execution_governance', 'medium', '{"blocked_zap_ids": [], "blocked_apps": []}', true FROM p
WHERE NOT EXISTS (
  SELECT 1 FROM governance.policy_rules WHERE policy_id = p.id AND rule_type = 'zap_execution_governance'
);
