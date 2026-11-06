-- Epic 6, Features 6.3/6.4 — MCP Stale Assurance Evidence. Unlike
-- mcp_credential_exposure, severity here IS policy-configurable — how
-- urgently to treat lapsed evidence is a judgment call for the policy
-- author, not a critical-by-definition finding.

INSERT INTO governance.rule_schemas (type, display_name, description, schema_json, ui_schema_json) VALUES
('mcp_stale_assurance_evidence', 'MCP Stale Assurance Evidence',
  'Flag MCP servers whose previously-validated assurance evidence (config export, credential rotation, revocation test, redeployment test) has expired and needs revalidation',
  '{"fields": [
    {"name": "severity", "type": "severity", "label": "Severity", "required": true,
     "options": ["low", "medium", "high", "critical"]}
  ]}',
  '{"icon": "shield-off", "color": "orange", "group": "mcp_governance"}'
)
ON CONFLICT (type) DO NOTHING;
