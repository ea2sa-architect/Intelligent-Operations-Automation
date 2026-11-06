-- Epic 5, Feature 5.3 — MCP Credential Exposure. Unlike the other MCP rule
-- types (mcp_tool_allowlist, mcp_authorization_posture, mcp_untrusted_publisher),
-- this one's severity is NOT policy-configurable — rule-evaluator.js forces
-- 'critical' for this rule_type regardless of what's set here, because a
-- confirmed credential exposure is a critical finding by definition, not a
-- judgment call left to whoever authors the policy.

INSERT INTO governance.rule_schemas (type, display_name, description, schema_json, ui_schema_json) VALUES
('mcp_credential_exposure', 'MCP Credential Exposure',
  'Flag MCP servers with token passthrough or a confirmed hardcoded-credential match in their configuration data. Always evaluated as critical severity — not configurable.',
  '{"fields": [
    {"name": "severity", "type": "severity", "label": "Severity (fixed at critical for this rule)",
     "options": ["critical"]}
  ]}',
  '{"icon": "alert-octagon", "color": "red", "group": "mcp_governance"}'
)
ON CONFLICT (type) DO NOTHING;
