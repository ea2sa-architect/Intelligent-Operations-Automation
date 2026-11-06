-- EP-201-S12/S13 — AI model gateway enforcement. ai_provider_detection and
-- data_classification (005_rule_types.sql) already exist but check
-- workflow-node parameters and workflow tags respectively — a different,
-- workflow-level concern. This is the direct-request-path equivalent:
-- gating ai-inference-service's own POST /inference against the model
-- registry's real is_sanctioned column and the request's own
-- data_classification value, independent of whether an n8n workflow is
-- involved at all.

INSERT INTO governance.rule_schemas (type, display_name, description, schema_json, ui_schema_json) VALUES
('ai_model_governance', 'AI Model Governance',
  'Blocks or warns on inference requests to an unsanctioned model provider, or carrying data classified above the model''s allowed maximum.',
  '{"fields": [
    {"name": "require_sanctioned", "type": "enum", "label": "Require Sanctioned Provider",
     "options": ["true", "false"]},
    {"name": "max_data_classification", "type": "enum", "label": "Maximum Allowed Data Classification",
     "options": ["public", "internal", "confidential", "restricted"]},
    {"name": "severity", "type": "severity", "label": "Severity", "required": true,
     "options": ["low", "medium", "high", "critical"]}
  ]}',
  '{"icon": "cpu", "color": "purple", "group": "ai_governance"}'
) ON CONFLICT (type) DO NOTHING;

INSERT INTO governance.policies (name, description, status, metadata_json)
VALUES (
  'AI Model Direct-Request Governance',
  'Every direct call to POST /inference is checked against the target model''s sanctioned status and the request''s declared data classification — independent of whether the call originated from an n8n workflow (which has its own, separate node-level checks).',
  'active',
  '{"seeded": true, "rationale": "ai_inference.models.is_sanctioned and inference_requests.data_classification have existed since EP-102 but were never read by anything — this policy is what actually enforces them.", "remediation_guidance": "Mark the model sanctioned (or use a sanctioned model), or route the request through a lower-classification path."}'
) ON CONFLICT (name) DO NOTHING;

WITH p AS (SELECT id FROM governance.policies WHERE name = 'AI Model Direct-Request Governance')
INSERT INTO governance.policy_rules (policy_id, rule_type, severity, config_json, enabled)
SELECT id, 'ai_model_governance', 'high', '{"require_sanctioned": "true", "max_data_classification": "confidential"}', true FROM p
WHERE NOT EXISTS (
  SELECT 1 FROM governance.policy_rules WHERE policy_id = p.id AND rule_type = 'ai_model_governance'
);
