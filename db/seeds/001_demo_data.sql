-- ============================================================
-- IOA Governance Demo Seed  — 30-day Shadow AI scenario
-- Run after migrations:
--   psql $DATABASE_URL -f db/seeds/001_demo_data.sql
-- ============================================================

-- ── Phase 1: Model Registry (Sanctioned vs Shadow) ──────────
INSERT INTO ai_inference.models (name, version, provider, is_sanctioned, status) VALUES
  ('gpt-4o',             '2024-05',  'OpenAI',    true,  'active'),
  ('claude-3-5-sonnet',  '20241022', 'Anthropic', true,  'active'),
  ('deepseek-coder',     'v2',       'DeepSeek',  false, 'active'),   -- Shadow AI
  ('llama3:8b',          'latest',   'Ollama',    false, 'inactive')  -- Local Shadow AI
ON CONFLICT (name, version) DO NOTHING;

-- ── Phase 2: Governance Policies ────────────────────────────
INSERT INTO governance.policies (name, description, status, logic_json) VALUES
  (
    'PII-Redaction-Standard',
    'Redact personally identifiable information before sending to any model.',
    'active',
    '{"redact": ["email", "ssn", "phone"]}'
  ),
  (
    'Shadow-AI-Alert',
    'Escalate when an unsanctioned model is detected in use.',
    'active',
    '{"action": "escalate", "level": "medium", "trigger": "is_sanctioned = false"}'
  ),
  (
    'Source-Code-Upload-Block',
    'Block uploads of source code to external models.',
    'active',
    '{"action": "block", "pattern": "*.{js,ts,py,go,java}", "scope": "unsanctioned"}'
  )
ON CONFLICT (name) DO NOTHING;

-- ── Phase 3: 30-Day Telemetry — inference_logs hypertable ───
-- 80 % sanctioned (gpt-4o), 20 % shadow (deepseek-coder)
-- Daytime = human usage, night-time = automation spike
INSERT INTO telemetry.inference_logs (time, model_name, token_count, cost_usd, success, duration_ms)
SELECT
  ts,
  CASE WHEN random() > 0.2 THEN 'gpt-4o' ELSE 'deepseek-coder' END,
  (random() * 2000)::int + 100,
  round((random() * 0.05)::numeric, 6),
  random() > 0.05,
  (random() * 5000)::int + 200
FROM generate_series(
  now() - interval '30 days',
  now(),
  interval '15 minutes'
) AS ts;

-- Also feed the generic metrics hypertable so the existing SPA Telemetry page shows data
INSERT INTO telemetry.metrics (time, service_name, metric_name, value, labels_json)
SELECT
  ts,
  CASE (random() * 4)::int
    WHEN 0 THEN 'ai-inference-service'
    WHEN 1 THEN 'governance-service'
    WHEN 2 THEN 'audit-service'
    WHEN 3 THEN 'escalation-service'
    ELSE        'telemetry-service'
  END,
  (ARRAY['request_count','latency_ms','error_rate','token_usage'])[floor(random()*4+1)::int],
  round((random() * 1000)::numeric, 2),
  '{}'::jsonb
FROM generate_series(
  now() - interval '30 days',
  now(),
  interval '15 minutes'
) AS ts;

-- ── Phase 4: Red-Flag Audit Events ──────────────────────────
INSERT INTO audit.audit_events
  (event_type, actor_id, actor_type, resource_type, resource_id,
   action, outcome, service_name, details, created_at)
VALUES
  (
    'POLICY_VIOLATION',
    'dev_user_7', 'user',
    'model', 'deepseek-coder',
    'upload', 'success',
    'ai-inference-service',
    '{"model": "deepseek-coder", "violation": "Source code uploaded to unsanctioned model", "file_count": 3}'::jsonb,
    now() - interval '2 days'
  ),
  (
    'SHADOW_DISCOVERY',
    'git-scanner', 'system',
    'repository', 'private-agent-repo',
    'scan', 'success',
    'governance-service',
    '{"source": "git-scanner", "repo": "private-agent-repo", "finding": ".cursor/rules pointing to local ollama"}'::jsonb,
    now() - interval '5 hours'
  );

-- ── Phase 5: Auto-escalate the violations ───────────────────
INSERT INTO escalation.incidents (title, severity, status, context_json, triggered_at)
VALUES
  (
    'Policy Violation: Source code sent to deepseek-coder by dev_user_7',
    'high', 'open',
    '{"user": "dev_user_7", "model": "deepseek-coder", "policy": "Source-Code-Upload-Block"}'::jsonb,
    now() - interval '2 days'
  ),
  (
    'Shadow AI Discovery: local ollama config found in private-agent-repo',
    'medium', 'acknowledged',
    '{"source": "git-scanner", "repo": "private-agent-repo", "model": "llama3:8b"}'::jsonb,
    now() - interval '5 hours'
  );
