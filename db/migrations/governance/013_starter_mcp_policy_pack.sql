-- Epic 4, Feature 4.4 — Starter MCP Policy Pack. The original planning
-- document envisioned ~12 starter policies covering things like tool
-- definition hashing, redaction, and revocation testing — but several of
-- those map to governance evidence/telemetry concepts (Epic 6), not to a
-- rule_type this evaluator can actually evaluate yet. Seeding a policy whose
-- rule type never fires anything would be a no-op that looks active but
-- isn't — so this pack covers every rule_type that IS real today
-- (mcp_server_registration, mcp_tool_allowlist, mcp_authorization_posture,
-- mcp_untrusted_publisher, mcp_credential_exposure), each in the distinct
-- configurations that actually change evaluator behavior. That's 8, not 12 —
-- an honest count over a padded one.
--
-- Idempotent via the INSERT...ON CONFLICT DO NOTHING RETURNING id -> INSERT
-- pattern: on a re-run, the policy insert returns no row, so the dependent
-- rule insert (which SELECTs from that result) inserts nothing either.
--
-- "Seeded, identifiable separately from custom policies" (story) is
-- logic_json->>'seeded' = 'true'. "Enabled/disabled individually" uses the
-- existing policies.status and policy_rules.enabled columns — no new
-- mechanism needed. Rationale and remediation guidance live in logic_json
-- since policies has no dedicated columns for either.

INSERT INTO governance.policies (name, description, status, logic_json)
VALUES (
  'MCP Server Registration Required',
  'Any MCP server a workflow references must be present in the MCP registry — unregistered means unassessed, not low-risk.',
  'active',
  '{"seeded": true, "mcp_risk_mapped": "unregistered_server",
    "rationale": "A workflow can silently depend on an MCP server nobody has reviewed. Registration is the minimum bar before any trust judgment can be made.",
    "remediation_guidance": "Register the MCP server in the MCP Registry with its owner, transport, and hosting environment before this workflow goes live."}'
) ON CONFLICT (name) DO NOTHING;

WITH p AS (SELECT id FROM governance.policies WHERE name = 'MCP Server Registration Required')
INSERT INTO governance.policy_rules (policy_id, rule_type, severity, config_json, enabled)
SELECT id, 'mcp_server_registration', 'high', '{"require_approved_status": "false"}', true
FROM p
WHERE NOT EXISTS (SELECT 1 FROM governance.policy_rules WHERE policy_id = p.id);

INSERT INTO governance.policies (name, description, status, logic_json)
VALUES (
  'MCP Server Production Approval Required',
  'Stricter than baseline registration: a referenced MCP server must be registered AND approved, not merely pending_review.',
  'active',
  '{"seeded": true, "mcp_risk_mapped": "unapproved_server",
    "rationale": "Production-facing workflows should not depend on a server that is registered but still awaiting review.",
    "remediation_guidance": "Complete the MCP server''s review in the registry and move its status to approved before use in production workflows."}'
) ON CONFLICT (name) DO NOTHING;

WITH p AS (SELECT id FROM governance.policies WHERE name = 'MCP Server Production Approval Required')
INSERT INTO governance.policy_rules (policy_id, rule_type, severity, config_json, enabled)
SELECT id, 'mcp_server_registration', 'critical', '{"require_approved_status": "true"}', true
FROM p
WHERE NOT EXISTS (SELECT 1 FROM governance.policy_rules WHERE policy_id = p.id);

INSERT INTO governance.policies (name, description, status, logic_json)
VALUES (
  'MCP Tool Allowlist Enforcement',
  'Flags MCP servers a workflow connects to that expose denied tools, or tools still awaiting classification (deny-by-default).',
  'active',
  '{"seeded": true, "mcp_risk_mapped": "unapproved_tool_usage",
    "rationale": "Approving a server does not approve every tool it exposes. A workflow can reach a denied or unreviewed tool through an otherwise-approved server.",
    "remediation_guidance": "Classify and explicitly approve or deny every tool on the referenced server before this workflow is trusted."}'
) ON CONFLICT (name) DO NOTHING;

WITH p AS (SELECT id FROM governance.policies WHERE name = 'MCP Tool Allowlist Enforcement')
INSERT INTO governance.policy_rules (policy_id, rule_type, severity, config_json, enabled)
SELECT id, 'mcp_tool_allowlist', 'high', '{"block_pending_tools": "true"}', true
FROM p
WHERE NOT EXISTS (SELECT 1 FROM governance.policy_rules WHERE policy_id = p.id);

INSERT INTO governance.policies (name, description, status, logic_json)
VALUES (
  'MCP Tool Allowlist — Denied Tools Only',
  'A more lenient variant: does not block tools merely awaiting classification, but still treats an explicitly denied tool as critical.',
  'active',
  '{"seeded": true, "mcp_risk_mapped": "denied_tool_usage",
    "rationale": "Some teams want to allow newly-discovered, not-yet-classified tools to exist without blocking the workflow, while still hard-blocking anything a reviewer has explicitly denied.",
    "remediation_guidance": "Remove the workflow''s dependency on the denied tool, or have a reviewer reclassify it as allowed if the denial was made in error."}'
) ON CONFLICT (name) DO NOTHING;

WITH p AS (SELECT id FROM governance.policies WHERE name = 'MCP Tool Allowlist — Denied Tools Only')
INSERT INTO governance.policy_rules (policy_id, rule_type, severity, config_json, enabled)
SELECT id, 'mcp_tool_allowlist', 'critical', '{"block_pending_tools": "false"}', true
FROM p
WHERE NOT EXISTS (SELECT 1 FROM governance.policy_rules WHERE policy_id = p.id);

INSERT INTO governance.policies (name, description, status, logic_json)
VALUES (
  'MCP Authorization Posture — Audience-Restricted Tokens Required',
  'Requires OAuth audience restriction on every MCP authorization for a referenced server, in addition to flagging token passthrough.',
  'active',
  '{"seeded": true, "mcp_risk_mapped": "weak_authorization_posture",
    "rationale": "A token without audience restriction can be replayed against services it was never intended for. Token passthrough is a critical finding on its own.",
    "remediation_guidance": "Configure OAuth audience restriction on the authorization, and eliminate any token passthrough by using the platform''s own authorization flow instead of forwarding a client token."}'
) ON CONFLICT (name) DO NOTHING;

WITH p AS (SELECT id FROM governance.policies WHERE name = 'MCP Authorization Posture — Audience-Restricted Tokens Required')
INSERT INTO governance.policy_rules (policy_id, rule_type, severity, config_json, enabled)
SELECT id, 'mcp_authorization_posture', 'critical', '{"require_audience_restriction": "true"}', true
FROM p
WHERE NOT EXISTS (SELECT 1 FROM governance.policy_rules WHERE policy_id = p.id);

INSERT INTO governance.policies (name, description, status, logic_json)
VALUES (
  'MCP Authorization Posture — Baseline',
  'Flags token passthrough and servers with no authorization posture recorded at all, without requiring audience restriction specifically.',
  'active',
  '{"seeded": true, "mcp_risk_mapped": "missing_authorization_posture",
    "rationale": "Silence on authorization posture is not evidence of safety — the same unassessed-is-not-low-risk principle applied to registration.",
    "remediation_guidance": "Record the MCP server''s authorization configuration in the registry, even if audience restriction is not yet required by policy."}'
) ON CONFLICT (name) DO NOTHING;

WITH p AS (SELECT id FROM governance.policies WHERE name = 'MCP Authorization Posture — Baseline')
INSERT INTO governance.policy_rules (policy_id, rule_type, severity, config_json, enabled)
SELECT id, 'mcp_authorization_posture', 'high', '{"require_audience_restriction": "false"}', true
FROM p
WHERE NOT EXISTS (SELECT 1 FROM governance.policy_rules WHERE policy_id = p.id);

INSERT INTO governance.policies (name, description, status, logic_json)
VALUES (
  'MCP Untrusted Publisher Block',
  'Flags MCP servers from a publisher not marked trusted in the registry.',
  'active',
  '{"seeded": true, "mcp_risk_mapped": "untrusted_publisher",
    "rationale": "An MCP server from an unverified publisher carries supply-chain risk equivalent to an unreviewed dependency.",
    "remediation_guidance": "Verify the publisher''s identity and provenance, then mark trusted_publisher on the server record — or replace it with a server from a known-trusted publisher."}'
) ON CONFLICT (name) DO NOTHING;

WITH p AS (SELECT id FROM governance.policies WHERE name = 'MCP Untrusted Publisher Block')
INSERT INTO governance.policy_rules (policy_id, rule_type, severity, config_json, enabled)
SELECT id, 'mcp_untrusted_publisher', 'high', '{}', true
FROM p
WHERE NOT EXISTS (SELECT 1 FROM governance.policy_rules WHERE policy_id = p.id);

INSERT INTO governance.policies (name, description, status, logic_json)
VALUES (
  'MCP Credential Exposure — Critical',
  'Flags confirmed hardcoded-credential matches in MCP server configuration/resource data, and token passthrough. Always evaluated as critical regardless of configured severity.',
  'active',
  '{"seeded": true, "mcp_risk_mapped": "credential_exposure",
    "rationale": "A confirmed credential exposure is a critical finding by definition, not a judgment call — this is the one MCP rule type whose severity the evaluator forces to critical no matter what is configured here.",
    "remediation_guidance": "Rotate the exposed credential immediately and remove it from stored configuration or resource URI templates."}'
) ON CONFLICT (name) DO NOTHING;

WITH p AS (SELECT id FROM governance.policies WHERE name = 'MCP Credential Exposure — Critical')
INSERT INTO governance.policy_rules (policy_id, rule_type, severity, config_json, enabled)
SELECT id, 'mcp_credential_exposure', 'critical', '{}', true
FROM p
WHERE NOT EXISTS (SELECT 1 FROM governance.policy_rules WHERE policy_id = p.id);
