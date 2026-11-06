-- Rule type catalog: typed governance logic with metadata-driven UI schemas
CREATE TABLE IF NOT EXISTS governance.rule_schemas (
  type           TEXT        PRIMARY KEY,
  display_name   TEXT        NOT NULL,
  description    TEXT,
  schema_json    JSONB       NOT NULL DEFAULT '{}',
  ui_schema_json JSONB       NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Evolve policy_rules to support typed rules alongside existing condition_json rules
ALTER TABLE governance.policy_rules
  ADD COLUMN IF NOT EXISTS rule_type   TEXT REFERENCES governance.rule_schemas(type),
  ADD COLUMN IF NOT EXISTS config_json JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS severity    TEXT  NOT NULL DEFAULT 'medium'
                             CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  ADD COLUMN IF NOT EXISTS enabled     BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_policy_rules_rule_type
  ON governance.policy_rules(rule_type);

CREATE INDEX IF NOT EXISTS idx_policy_rules_severity
  ON governance.policy_rules(severity);

-- Seed 12 rule types with field schemas (schema_json) and UI hints (ui_schema_json)
INSERT INTO governance.rule_schemas (type, display_name, description, schema_json, ui_schema_json) VALUES

('pii_detection', 'PII Detection', 'Detect sensitive data fields exposed in workflow nodes',
  '{"fields": [
    {"name": "inspection_targets", "type": "multi_enum", "label": "Inspection Targets",
     "options": ["webhook_payload", "http_body", "prompt", "email", "database_query", "file_content"]},
    {"name": "sensitive_fields", "type": "json_array", "label": "Sensitive Field Names",
     "placeholder": "e.g. ssn, dob, credit_card"},
    {"name": "severity", "type": "severity", "label": "Severity", "required": true,
     "options": ["low", "medium", "high", "critical"]},
    {"name": "actions", "type": "multi_enum", "label": "Actions on Detection",
     "options": ["flag_workflow", "generate_event", "block_execution", "require_approval"]}
  ]}',
  '{"icon": "shield", "color": "red", "group": "data_protection"}'
),

('ai_provider_detection', 'External AI Detection', 'Detect use of external or unapproved AI providers',
  '{"fields": [
    {"name": "allowed_providers", "type": "json_array", "label": "Allowed Providers",
     "placeholder": "e.g. openai, anthropic, azure_openai"},
    {"name": "block_unknown", "type": "enum", "label": "Block Unknown Providers",
     "options": ["true", "false"]},
    {"name": "severity", "type": "severity", "label": "Severity", "required": true,
     "options": ["low", "medium", "high", "critical"]},
    {"name": "actions", "type": "multi_enum", "label": "Actions",
     "options": ["flag_workflow", "generate_event", "block_execution", "alert_team"]}
  ]}',
  '{"icon": "cpu", "color": "purple", "group": "ai_governance"}'
),

('prompt_inspection', 'Prompt Inspection', 'Inspect AI prompt content for forbidden patterns or excessive length',
  '{"fields": [
    {"name": "forbidden_patterns", "type": "json_array", "label": "Forbidden Patterns (regex)",
     "placeholder": "e.g. \\\\bpassword\\\\b, \\\\bsecret\\\\b"},
    {"name": "max_length", "type": "string", "label": "Maximum Prompt Length (chars)",
     "placeholder": "e.g. 4096"},
    {"name": "severity", "type": "severity", "label": "Severity", "required": true,
     "options": ["low", "medium", "high", "critical"]},
    {"name": "actions", "type": "multi_enum", "label": "Actions",
     "options": ["flag_workflow", "truncate_prompt", "block_execution", "generate_event"]}
  ]}',
  '{"icon": "message-square", "color": "orange", "group": "ai_governance"}'
),

('logging_restriction', 'Logging Restriction', 'Prevent sensitive fields from appearing in workflow logs',
  '{"fields": [
    {"name": "forbidden_fields", "type": "json_array", "label": "Fields to Suppress",
     "placeholder": "e.g. password, api_key, token"},
    {"name": "log_destinations", "type": "multi_enum", "label": "Apply To",
     "options": ["stdout", "file", "external_api", "database", "all"]},
    {"name": "severity", "type": "severity", "label": "Severity", "required": true,
     "options": ["low", "medium", "high", "critical"]},
    {"name": "actions", "type": "multi_enum", "label": "Actions",
     "options": ["mask_field", "suppress_log", "generate_event", "block_execution"]}
  ]}',
  '{"icon": "eye-off", "color": "yellow", "group": "data_protection"}'
),

('data_classification', 'Data Classification', 'Require workflows to carry mandatory governance tags or classification labels',
  '{"fields": [
    {"name": "required_tags", "type": "json_array", "label": "Required Tags",
     "placeholder": "e.g. gdpr, hipaa, pii"},
    {"name": "min_classification", "type": "enum", "label": "Minimum Classification Level",
     "options": ["public", "internal", "confidential", "restricted"]},
    {"name": "severity", "type": "severity", "label": "Severity", "required": true,
     "options": ["low", "medium", "high", "critical"]},
    {"name": "actions", "type": "multi_enum", "label": "Actions",
     "options": ["flag_workflow", "generate_event", "block_execution", "require_approval"]}
  ]}',
  '{"icon": "tag", "color": "blue", "group": "compliance"}'
),

('approval_requirement', 'Human Approval Required', 'Require human sign-off before workflow execution',
  '{"fields": [
    {"name": "approver_roles", "type": "json_array", "label": "Approver Roles",
     "placeholder": "e.g. compliance_officer, security_team"},
    {"name": "timeout_hours", "type": "string", "label": "Approval Timeout (hours)",
     "placeholder": "e.g. 24"},
    {"name": "escalate_on_timeout", "type": "enum", "label": "Escalate on Timeout",
     "options": ["true", "false"]},
    {"name": "severity", "type": "severity", "label": "Severity", "required": true,
     "options": ["low", "medium", "high", "critical"]}
  ]}',
  '{"icon": "user-check", "color": "green", "group": "controls"}'
),

('encryption_enforcement', 'Encryption Enforcement', 'Enforce HTTPS/TLS on all outbound connections',
  '{"fields": [
    {"name": "required_protocols", "type": "multi_enum", "label": "Required Protocols",
     "options": ["HTTPS", "TLS_1_2", "TLS_1_3", "mTLS"]},
    {"name": "exempt_domains", "type": "json_array", "label": "Exempt Domains",
     "placeholder": "e.g. localhost, 127.0.0.1"},
    {"name": "severity", "type": "severity", "label": "Severity", "required": true,
     "options": ["low", "medium", "high", "critical"]},
    {"name": "actions", "type": "multi_enum", "label": "Actions",
     "options": ["flag_workflow", "block_execution", "generate_event"]}
  ]}',
  '{"icon": "lock", "color": "green", "group": "controls"}'
),

('token_limit', 'LLM Token Limit', 'Govern maximum token usage per LLM call to prevent runaway costs or prompt injection via long inputs',
  '{"fields": [
    {"name": "max_input_tokens", "type": "string", "label": "Max Input Tokens",
     "placeholder": "e.g. 8192"},
    {"name": "max_output_tokens", "type": "string", "label": "Max Output Tokens",
     "placeholder": "e.g. 2048"},
    {"name": "model_scope", "type": "json_array", "label": "Apply to Models (empty = all)",
     "placeholder": "e.g. gpt-4, claude-3-opus"},
    {"name": "severity", "type": "severity", "label": "Severity", "required": true,
     "options": ["low", "medium", "high", "critical"]},
    {"name": "actions", "type": "multi_enum", "label": "Actions",
     "options": ["flag_workflow", "truncate_input", "block_execution", "generate_event"]}
  ]}',
  '{"icon": "hash", "color": "indigo", "group": "ai_governance"}'
),

('model_allowlist', 'Model Allowlist', 'Restrict AI model usage to an approved set of providers and model versions',
  '{"fields": [
    {"name": "allowed_models", "type": "json_array", "label": "Allowed Models",
     "placeholder": "e.g. gpt-4o, claude-sonnet-4, gemini-pro"},
    {"name": "block_unlisted", "type": "enum", "label": "Block Unlisted Models",
     "options": ["true", "false"]},
    {"name": "severity", "type": "severity", "label": "Severity", "required": true,
     "options": ["low", "medium", "high", "critical"]},
    {"name": "actions", "type": "multi_enum", "label": "Actions",
     "options": ["flag_workflow", "block_execution", "generate_event", "require_approval"]}
  ]}',
  '{"icon": "check-circle", "color": "teal", "group": "ai_governance"}'
),

('workflow_scope', 'Workflow Scope Restriction', 'Restrict workflow execution to approved environments',
  '{"fields": [
    {"name": "allowed_environments", "type": "multi_enum", "label": "Allowed Environments",
     "options": ["production", "staging", "development", "testing"]},
    {"name": "allowed_projects", "type": "json_array", "label": "Allowed Projects (empty = all)",
     "placeholder": "e.g. project-id-1, project-id-2"},
    {"name": "severity", "type": "severity", "label": "Severity", "required": true,
     "options": ["low", "medium", "high", "critical"]},
    {"name": "actions", "type": "multi_enum", "label": "Actions",
     "options": ["flag_workflow", "block_execution", "generate_event"]}
  ]}',
  '{"icon": "layers", "color": "slate", "group": "controls"}'
),

('execution_rate', 'Execution Rate Limit', 'Prevent runaway automation by capping workflow execution frequency',
  '{"fields": [
    {"name": "max_per_hour", "type": "string", "label": "Max Executions per Hour",
     "placeholder": "e.g. 60"},
    {"name": "max_per_day", "type": "string", "label": "Max Executions per Day",
     "placeholder": "e.g. 500"},
    {"name": "burst_limit", "type": "string", "label": "Burst Limit (concurrent)",
     "placeholder": "e.g. 10"},
    {"name": "severity", "type": "severity", "label": "Severity", "required": true,
     "options": ["low", "medium", "high", "critical"]},
    {"name": "actions", "type": "multi_enum", "label": "Actions",
     "options": ["throttle", "block_execution", "generate_event", "alert_team"]}
  ]}',
  '{"icon": "activity", "color": "amber", "group": "controls"}'
),

('outbound_domain', 'Outbound Domain Restriction', 'Restrict which external domains a workflow may call',
  '{"fields": [
    {"name": "allowed_domains", "type": "json_array", "label": "Allowed Domains",
     "placeholder": "e.g. api.openai.com, hooks.slack.com"},
    {"name": "block_unlisted", "type": "enum", "label": "Block Unlisted Domains",
     "options": ["true", "false"]},
    {"name": "exempt_private_ranges", "type": "enum", "label": "Exempt Private IP Ranges",
     "options": ["true", "false"]},
    {"name": "severity", "type": "severity", "label": "Severity", "required": true,
     "options": ["low", "medium", "high", "critical"]},
    {"name": "actions", "type": "multi_enum", "label": "Actions",
     "options": ["flag_workflow", "block_execution", "generate_event", "alert_team"]}
  ]}',
  '{"icon": "globe", "color": "cyan", "group": "controls"}'
)

ON CONFLICT (type) DO NOTHING;
