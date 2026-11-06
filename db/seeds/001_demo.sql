-- ============================================================
-- IOA Governance Platform — 30-day demo dataset
-- Run after migrations: psql $DATABASE_URL -f db/seeds/001_demo.sql
-- Idempotent: uses ON CONFLICT DO NOTHING throughout
-- ============================================================

-- ── 1. MODEL REGISTRY ────────────────────────────────────────
-- Two sanctioned (active), two shadow (inactive).
-- provider and sanctioned flag stored in metadata_json since
-- the schema doesn't have dedicated columns for them.

INSERT INTO ai_inference.models (id, name, version, endpoint, status, metadata_json)
VALUES
  ('11111111-0000-0000-0000-000000000001',
   'gpt-4o', '2024-11', 'https://api.openai.com/v1', 'active',
   '{"provider":"OpenAI","sanctioned":true}'),

  ('11111111-0000-0000-0000-000000000002',
   'claude-3-5-sonnet', '20241022', 'https://api.anthropic.com/v1', 'active',
   '{"provider":"Anthropic","sanctioned":true}'),

  ('11111111-0000-0000-0000-000000000003',
   'deepseek-coder', 'v2', 'https://api.deepseek.com/v1', 'inactive',
   '{"provider":"DeepSeek","sanctioned":false,"flag":"shadow_ai"}'),

  ('11111111-0000-0000-0000-000000000004',
   'llama3:8b', '8b', 'http://localhost:11434', 'inactive',
   '{"provider":"Ollama","sanctioned":false,"flag":"local_shadow"}')
ON CONFLICT (name, version) DO NOTHING;


-- ── 2. GOVERNANCE POLICIES + RULES + BINDINGS ────────────────

INSERT INTO governance.policies (id, name, description, status, version)
VALUES
  ('22222222-0000-0000-0000-000000000001',
   'PII-Redaction-Standard',
   'Redact PII fields before any model receives input',
   'active', 1),

  ('22222222-0000-0000-0000-000000000002',
   'Shadow-AI-Detection',
   'Detect and escalate usage of unsanctioned or local models',
   'active', 1),

  ('22222222-0000-0000-0000-000000000003',
   'Source-Code-Exfiltration-Guard',
   'Block source code uploads to models without data-residency approval',
   'active', 1)
ON CONFLICT (name) DO NOTHING;

-- Policy rules
INSERT INTO governance.policy_rules (policy_id, condition_json, action, priority)
SELECT id, rule.condition_json::jsonb, rule.action, rule.priority
FROM governance.policies p
CROSS JOIN (VALUES
  ('22222222-0000-0000-0000-000000000001',
   '{"match":{"field":"input","contains_pii":["email","ssn","phone","dob"]}}',
   'redact', 10),
  ('22222222-0000-0000-0000-000000000001',
   '{"match":{"field":"input","pattern":"\\b\\d{3}-\\d{2}-\\d{4}\\b"}}',
   'block', 20),
  ('22222222-0000-0000-0000-000000000002',
   '{"match":{"model_status":"inactive","metadata.sanctioned":false}}',
   'escalate', 10),
  ('22222222-0000-0000-0000-000000000002',
   '{"match":{"model_endpoint_prefix":"http://localhost"}}',
   'block', 20),
  ('22222222-0000-0000-0000-000000000003',
   '{"match":{"input_type":"source_code","model_metadata.sanctioned":false}}',
   'block', 10)
) AS rule(policy_id, condition_json, action, priority)
WHERE p.id = rule.policy_id::uuid
ON CONFLICT DO NOTHING;

-- Bind policies to the ai-inference-service entity
INSERT INTO governance.policy_bindings (policy_id, entity_type, entity_id)
VALUES
  ('22222222-0000-0000-0000-000000000001', 'service', 'ai-inference-service'),
  ('22222222-0000-0000-0000-000000000002', 'service', 'ai-inference-service'),
  ('22222222-0000-0000-0000-000000000003', 'service', 'ai-inference-service')
ON CONFLICT (policy_id, entity_type, entity_id) DO NOTHING;

-- Snapshot initial versions
INSERT INTO governance.policy_versions (policy_id, version, snapshot_json)
SELECT id, version, to_jsonb(p) FROM governance.policies p
WHERE id IN (
  '22222222-0000-0000-0000-000000000001',
  '22222222-0000-0000-0000-000000000002',
  '22222222-0000-0000-0000-000000000003'
)
ON CONFLICT (policy_id, version) DO NOTHING;


-- ── 3. 30-DAY INFERENCE HISTORY ──────────────────────────────
-- One request per 15-minute slot.
-- Daytime (06-20): 90 % sanctioned (60 % gpt-4o, 30 % claude), 10 % shadow.
-- Nighttime (21-05): 50 % sanctioned, 50 % shadow (automation / scripts).

INSERT INTO ai_inference.inference_requests
  (model_id, input_hash, latency_ms, status, created_at)
SELECT
  (CASE
    WHEN extract(hour FROM ts) BETWEEN 6 AND 20 THEN
      CASE
        WHEN random() < 0.60 THEN '11111111-0000-0000-0000-000000000001'  -- gpt-4o
        WHEN random() < 0.75 THEN '11111111-0000-0000-0000-000000000002'  -- claude
        WHEN random() < 0.87 THEN '11111111-0000-0000-0000-000000000003'  -- deepseek
        ELSE                      '11111111-0000-0000-0000-000000000004'  -- llama
      END
    ELSE
      CASE
        WHEN random() < 0.30 THEN '11111111-0000-0000-0000-000000000001'  -- gpt-4o
        WHEN random() < 0.50 THEN '11111111-0000-0000-0000-000000000002'  -- claude
        WHEN random() < 0.75 THEN '11111111-0000-0000-0000-000000000003'  -- deepseek
        ELSE                      '11111111-0000-0000-0000-000000000004'  -- llama
      END
  END)::uuid,
  md5(ts::text),                               -- deterministic input_hash per slot
  (random() * 4800 + 200)::int,                -- 200–5000 ms latency
  CASE WHEN random() < 0.95 THEN 'completed' ELSE 'failed' END,
  ts
FROM generate_series(
  now() - interval '30 days',
  now(),
  interval '15 minutes'
) AS ts;

-- Attach a governance decision to every completed request
INSERT INTO ai_inference.decisions
  (inference_request_id, policy_id, outcome, confidence, created_at)
SELECT
  r.id,
  (CASE
    WHEN m.status = 'active' THEN '22222222-0000-0000-0000-000000000001'  -- PII policy
    ELSE                          '22222222-0000-0000-0000-000000000002'  -- Shadow-AI policy
  END)::uuid,
  CASE
    WHEN m.status = 'active' THEN 'allow'
    ELSE                          'deny'
  END,
  CASE
    WHEN m.status = 'active' THEN round((0.85 + random() * 0.14)::numeric, 4)
    ELSE                          round((0.70 + random() * 0.29)::numeric, 4)
  END,
  r.created_at
FROM ai_inference.inference_requests r
JOIN ai_inference.models m ON m.id = r.model_id
WHERE r.status = 'completed'
  AND r.created_at >= now() - interval '30 days';


-- ── 4. TELEMETRY METRICS (30 days × 15-min × per service) ────
-- Each service reports request_count, latency_p99_ms, and error_rate.
-- ai-inference-service also reports token_count.
-- Values are randomised around realistic baselines.

INSERT INTO telemetry.metrics (time, service_name, metric_name, value, labels_json)
SELECT
  ts,
  svc,
  mname,
  round((base + (random() - 0.5) * variance * 2)::numeric, 4),
  jsonb_build_object('env', 'production')
FROM generate_series(
  now() - interval '30 days',
  now(),
  interval '15 minutes'
) AS ts
CROSS JOIN (VALUES
  ('governance-service',   'request_count',  35,   20),
  ('governance-service',   'latency_p99_ms', 120,  60),
  ('governance-service',   'error_rate',     0.01, 0.005),
  ('ai-inference-service', 'request_count',  20,   15),
  ('ai-inference-service', 'latency_p99_ms', 1800, 900),
  ('ai-inference-service', 'error_rate',     0.05, 0.03),
  ('ai-inference-service', 'token_count',    1200, 800),
  ('audit-service',        'request_count',  15,   8),
  ('audit-service',        'latency_p99_ms', 80,   30),
  ('escalation-service',   'request_count',  5,    3),
  ('escalation-service',   'latency_p99_ms', 95,   40),
  ('telemetry-service',    'ingest_rate',    80,   30),
  ('telemetry-service',    'latency_p99_ms', 60,   20)
) AS m(svc, mname, base, variance);


-- ── 5. AUDIT EVENTS ──────────────────────────────────────────
-- Normal traffic (sampled) + two injected red-flag violations.
-- outcome must be one of: 'success', 'failure', 'partial'

-- Sampled normal allow/deny decisions as audit trail
INSERT INTO audit.audit_events
  (event_type, actor_id, actor_type, resource_type, resource_id,
   action, outcome, metadata_json, created_at)
SELECT
  CASE WHEN m.status = 'active' THEN 'policy.evaluated' ELSE 'policy.violation' END,
  'system',
  'service',
  'inference_request',
  r.id::text,
  'evaluate',
  CASE WHEN m.status = 'active' THEN 'success' ELSE 'failure' END,
  jsonb_build_object(
    'model',      m.name,
    'sanctioned', (m.status = 'active'),
    'policy',     CASE WHEN m.status = 'active' THEN 'PII-Redaction-Standard' ELSE 'Shadow-AI-Detection' END
  ),
  r.created_at
FROM ai_inference.inference_requests r
JOIN ai_inference.models m ON m.id = r.model_id
WHERE r.created_at >= now() - interval '30 days'
  AND random() < 0.1;   -- 10 % sample keeps the audit log realistic

-- Red-flag: source code uploaded to unsanctioned model (2 days ago)
INSERT INTO audit.audit_events
  (event_type, actor_id, actor_type, resource_type, resource_id,
   action, outcome, metadata_json, created_at)
VALUES (
  'policy.violation',
  'dev_user_7', 'user',
  'inference_request', '11111111-0000-0000-0000-000000000003',
  'upload',
  'failure',
  '{"model":"deepseek-coder","violation":"source_code_exfiltration","detail":"Source code uploaded to unsanctioned model","severity":"high"}',
  now() - interval '2 days'
),
(
  'shadow_ai.discovered',
  'git-scanner', 'automation',
  'repository', 'private-agent-repo',
  'scan',
  'failure',
  '{"source":"git-scanner","finding":".cursor/rules pointing to local ollama","model":"llama3:8b","severity":"critical"}',
  now() - interval '5 hours'
);


-- ── 6. ESCALATION RULES + INCIDENTS ──────────────────────────

INSERT INTO escalation.escalation_rules
  (id, name, condition_json, severity, channels_json, enabled)
VALUES
  ('33333333-0000-0000-0000-000000000001',
   'Shadow-AI-Usage-Detected',
   '{"trigger":"policy.violation","model_sanctioned":false}',
   'high',
   '["email","slack"]',
   true),

  ('33333333-0000-0000-0000-000000000002',
   'Source-Code-Exfiltration-Attempt',
   '{"trigger":"policy.violation","violation_type":"source_code_exfiltration"}',
   'critical',
   '["email","slack","pagerduty"]',
   true),

  ('33333333-0000-0000-0000-000000000003',
   'Local-Shadow-AI-Discovered',
   '{"trigger":"shadow_ai.discovered","endpoint_prefix":"http://localhost"}',
   'critical',
   '["email","slack"]',
   true)
ON CONFLICT (name) DO NOTHING;

-- Incidents triggered by the red-flag events above
INSERT INTO escalation.incidents
  (id, rule_id, title, severity, status, context_json, triggered_at, acknowledged_at)
VALUES
  ('44444444-0000-0000-0000-000000000001',
   '33333333-0000-0000-0000-000000000002',
   'Source code uploaded to DeepSeek by dev_user_7',
   'critical', 'acknowledged',
   '{"actor":"dev_user_7","model":"deepseek-coder","repo":"private-agent-repo"}',
   now() - interval '2 days',
   now() - interval '47 hours'),

  ('44444444-0000-0000-0000-000000000002',
   '33333333-0000-0000-0000-000000000003',
   'Local Ollama llama3:8b found in .cursor/rules of private-agent-repo',
   'critical', 'open',
   '{"source":"git-scanner","model":"llama3:8b","path":".cursor/rules"}',
   now() - interval '5 hours',
   NULL)
ON CONFLICT DO NOTHING;

-- Notification log for the acknowledged incident
INSERT INTO escalation.escalation_log
  (incident_id, channel, recipient, message_json, status, sent_at)
VALUES
  ('44444444-0000-0000-0000-000000000001',
   'slack', '#ioa-alerts',
   '{"text":"CRITICAL: Source code exfiltration via deepseek-coder by dev_user_7. Incident 44444444-0000-0000-0000-000000000001 opened."}',
   'sent', now() - interval '2 days' + interval '1 minute'),

  ('44444444-0000-0000-0000-000000000001',
   'email', 'security@company.com',
   '{"subject":"[IOA] Critical Policy Violation — Source Code Exfiltration","body":"See incident 44444444-0000-0000-0000-000000000001"}',
   'sent', now() - interval '2 days' + interval '2 minutes')
ON CONFLICT DO NOTHING;
