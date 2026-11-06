-- EP-105-S7/S9 — completes the starter MCP policy pack's last two gaps:
-- expired approval and tool definition drift. Both rule types now have real
-- evaluators (rule-evaluator.js) — this registers them in rule_schemas
-- (required before any policy_rule can reference them, via the
-- policy_rules.rule_type FK) and seeds the starter policy, same pattern as
-- migrations 010/011/014.

INSERT INTO governance.rule_schemas (type, display_name, description, schema_json, ui_schema_json) VALUES
('mcp_approval_expiration', 'MCP Approval Expiration',
  'Flag MCP servers whose registry expiration_date has passed — an expired approval is not a currently-valid one.',
  '{"fields": [{"name": "severity", "type": "severity", "label": "Severity", "options": ["low", "medium", "high", "critical"], "required": true}]}',
  '{"icon": "clock-alert", "color": "orange", "group": "mcp_governance"}'
)
ON CONFLICT (type) DO NOTHING;

INSERT INTO governance.rule_schemas (type, display_name, description, schema_json, ui_schema_json) VALUES
('mcp_tool_definition_drift', 'MCP Tool Definition Drift',
  'Flag MCP tools whose definition changed after approval (description/schema hash mismatch) and have not been reapproved since.',
  '{"fields": [{"name": "severity", "type": "severity", "label": "Severity", "options": ["low", "medium", "high", "critical"], "required": true}]}',
  '{"icon": "git-compare", "color": "orange", "group": "mcp_governance"}'
)
ON CONFLICT (type) DO NOTHING;

INSERT INTO governance.policies (name, description, status, logic_json)
VALUES (
  'MCP Approval Expiration Block',
  'Flags MCP servers past their registry expiration_date — an expired approval must be renewed, not silently relied on.',
  'active',
  '{"seeded": true, "mcp_risk_mapped": "expired_approval",
    "rationale": "An approval with no expiry check is a one-time review masquerading as an ongoing guarantee. Time passing is itself a risk-relevant event.",
    "remediation_guidance": "Re-review the MCP server and set a new expiration_date, or retire it if it should no longer be relied on."}'
) ON CONFLICT (name) DO NOTHING;

WITH p AS (SELECT id FROM governance.policies WHERE name = 'MCP Approval Expiration Block')
INSERT INTO governance.policy_rules (policy_id, rule_type, severity, config_json, enabled)
SELECT id, 'mcp_approval_expiration', 'high', '{}', true
FROM p
WHERE NOT EXISTS (SELECT 1 FROM governance.policy_rules WHERE policy_id = p.id);

INSERT INTO governance.policies (name, description, status, logic_json)
VALUES (
  'MCP Tool Definition Drift Enforcement',
  'Flags MCP tools whose definition drifted after approval and remain unreviewed — completes the drift-detection story begun in the registry (Epic 3, Feature 3.3).',
  'active',
  '{"seeded": true, "mcp_risk_mapped": "unreviewed_tool_drift",
    "rationale": "A tool that silently changed shape after being approved is functionally the same unassessed risk as a tool that was never classified at all.",
    "remediation_guidance": "Review the tool''s new definition (previous version is preserved in its definition history) and explicitly reapprove or deny it."}'
) ON CONFLICT (name) DO NOTHING;

WITH p AS (SELECT id FROM governance.policies WHERE name = 'MCP Tool Definition Drift Enforcement')
INSERT INTO governance.policy_rules (policy_id, rule_type, severity, config_json, enabled)
SELECT id, 'mcp_tool_definition_drift', 'high', '{}', true
FROM p
WHERE NOT EXISTS (SELECT 1 FROM governance.policy_rules WHERE policy_id = p.id);
