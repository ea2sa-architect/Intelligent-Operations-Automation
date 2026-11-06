-- Three more MCP-specific rule types, evaluated by rule-evaluator.js against
-- workflow_governance.workflow_mcp_references joined into mcp_governance
-- (tools/authorizations of any server a workflow actually references).

INSERT INTO governance.rule_schemas (type, display_name, description, schema_json, ui_schema_json) VALUES

('mcp_tool_allowlist', 'MCP Tool Allowlist',
  'Flag MCP servers a workflow connects to that expose denied or not-yet-classified tools — approving a server does not approve every tool on it',
  '{"fields": [
    {"name": "block_pending_tools", "type": "enum", "label": "Block Tools Awaiting Classification",
     "options": ["true", "false"]},
    {"name": "severity", "type": "severity", "label": "Severity", "required": true,
     "options": ["low", "medium", "high", "critical"]}
  ]}',
  '{"icon": "list-checks", "color": "orange", "group": "mcp_governance"}'
),

('mcp_authorization_posture', 'MCP Authorization Posture',
  'Flag MCP servers with token passthrough, missing audience restriction, or no recorded authorization posture at all. Recommended severity: critical (token passthrough is a serious finding).',
  '{"fields": [
    {"name": "require_audience_restriction", "type": "enum", "label": "Require Audience-Restricted Tokens",
     "options": ["true", "false"]},
    {"name": "severity", "type": "severity", "label": "Severity", "required": true,
     "options": ["low", "medium", "high", "critical"]}
  ]}',
  '{"icon": "key", "color": "red", "group": "mcp_governance"}'
),

('mcp_untrusted_publisher', 'MCP Untrusted Publisher',
  'Flag workflows connecting to MCP servers from a publisher that has not been marked trusted in the registry',
  '{"fields": [
    {"name": "severity", "type": "severity", "label": "Severity", "required": true,
     "options": ["low", "medium", "high", "critical"]}
  ]}',
  '{"icon": "shield-alert", "color": "orange", "group": "mcp_governance"}'
)
ON CONFLICT (type) DO NOTHING;
