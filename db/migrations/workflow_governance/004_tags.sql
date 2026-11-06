-- Governed tag registry: replaces the hardcoded TAG_RISK map in the frontend.
-- role = 'governance' → carries a risk score, shown as a risk signal
-- role = 'folder'     → organizational grouping (mirrors n8n folder/tag structure)
-- role = 'general'    → informational only, no risk implication

CREATE TABLE IF NOT EXISTS workflow_governance.tags (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL UNIQUE,
  role        TEXT        NOT NULL DEFAULT 'general'
                          CHECK (role IN ('folder', 'governance', 'general')),
  risk_score  INT         CHECK (risk_score BETWEEN 0 AND 100),
  color       TEXT,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tags_role ON workflow_governance.tags(role);

-- Seed the existing governance tags so risk scoring is unaffected
INSERT INTO workflow_governance.tags (name, role, risk_score, color, description) VALUES
  ('shadow-ai',           'governance', 100, 'bg-red-200 text-red-800',       'AI operating outside organisational oversight'),
  ('hipaa',               'governance',  95, 'bg-red-100 text-red-700',        'Workflow touches HIPAA-regulated health data'),
  ('external-ai',         'governance',  90, 'bg-purple-100 text-purple-700',  'Calls external AI provider'),
  ('gdpr',                'governance',  80, 'bg-red-100 text-red-700',        'Workflow processes EU personal data'),
  ('pii',                 'governance',  85, 'bg-red-100 text-red-700',        'PII explicitly declared by workflow owner'),
  ('financial',           'governance',  75, 'bg-orange-100 text-orange-700',  'Touches financial records or transactions'),
  ('customer-data',       'governance',  70, 'bg-orange-100 text-orange-700',  'Customer records in scope'),
  ('credential',          'governance',  65, 'bg-orange-100 text-orange-700',  'Handles credentials or secrets'),
  ('production',          'governance',  40, 'bg-yellow-100 text-yellow-700',  'Runs against production systems'),
  ('executive-reporting', 'governance',  30, 'bg-blue-100 text-blue-700',      'Feeds executive or board reporting')
ON CONFLICT (name) DO NOTHING;
