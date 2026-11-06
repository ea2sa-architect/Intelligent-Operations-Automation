-- Epic 6/Feature 4.4 — extends the starter MCP policy pack (originally 8
-- policies covering the 8 rule types that existed then) with a 9th, now that
-- mcp_stale_assurance_evidence is a real, evaluable rule type.

INSERT INTO governance.policies (name, description, status, logic_json)
VALUES (
  'MCP Stale Assurance Evidence',
  'Flags MCP servers whose previously-validated assurance evidence (config export, credential rotation, revocation test, redeployment test) has expired.',
  'active',
  '{"seeded": true, "mcp_risk_mapped": "stale_assurance_evidence",
    "rationale": "Evidence that was once validated does not stay true forever — a credential-rotation or revocation test that has gone stale is functionally the same as never having tested it at all.",
    "remediation_guidance": "Resubmit and revalidate the expired evidence, or perform the underlying test again (credential rotation, revocation, redeployment/recovery) and record fresh evidence."}'
) ON CONFLICT (name) DO NOTHING;

WITH p AS (SELECT id FROM governance.policies WHERE name = 'MCP Stale Assurance Evidence')
INSERT INTO governance.policy_rules (policy_id, rule_type, severity, config_json, enabled)
SELECT id, 'mcp_stale_assurance_evidence', 'medium', '{}', true
FROM p
WHERE NOT EXISTS (SELECT 1 FROM governance.policy_rules WHERE policy_id = p.id);
