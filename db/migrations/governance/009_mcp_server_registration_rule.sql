-- New rule type: mcp_server_registration. Lets a policy require that any MCP
-- server a bound workflow references is present in the MCP registry (and,
-- optionally, already approved there — not just registered). Evaluated by
-- rule-evaluator.js's evalMcpServerRegistration against
-- workflow_governance.workflow_mcp_references (populated in the MCP
-- Governance epic's M1 workflow-linkage work).

INSERT INTO governance.rule_schemas (type, display_name, description, schema_json, ui_schema_json) VALUES
('mcp_server_registration', 'MCP Server Registration Required',
  'Require that any MCP server a workflow references is registered — and optionally approved — in the MCP registry',
  '{"fields": [
    {"name": "require_approved_status", "type": "enum", "label": "Require Approved (not just registered)",
     "options": ["true", "false"]},
    {"name": "severity", "type": "severity", "label": "Severity", "required": true,
     "options": ["low", "medium", "high", "critical"]}
  ]}',
  '{"icon": "server", "color": "red", "group": "mcp_governance"}'
)
ON CONFLICT (type) DO NOTHING;
