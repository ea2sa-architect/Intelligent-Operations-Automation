-- Workflow Governance schema: workflow discovery, risk scoring, policy binding

CREATE SCHEMA IF NOT EXISTS workflow_governance;

CREATE TABLE IF NOT EXISTS workflow_governance.workflows (
  id                 TEXT          PRIMARY KEY,
  name               TEXT          NOT NULL,
  n8n_id             TEXT          UNIQUE NOT NULL,
  active             BOOLEAN       NOT NULL DEFAULT true,
  webhook_url        TEXT,
  owner_id           TEXT,
  tags               TEXT[],
  metadata_json      JSONB         NOT NULL DEFAULT '{}',
  risk_score         NUMERIC(5,2),
  risk_level         TEXT          CHECK (risk_level IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  risk_breakdown_json JSONB,
  policies_applied   BOOLEAN       NOT NULL DEFAULT false,
  discovered_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  scored_at          TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workflow_governance.workflow_nodes (
  id               TEXT          PRIMARY KEY,
  workflow_id      TEXT          NOT NULL REFERENCES workflow_governance.workflows(id) ON DELETE CASCADE,
  node_id          TEXT          NOT NULL,
  node_name        TEXT          NOT NULL,
  n8n_type         TEXT          NOT NULL,
  governance_type  TEXT          NOT NULL CHECK (governance_type IN (
    'ai_inference','http','database','approval','logic',
    'transform','storage','notification','schedule','webhook','credential','unknown'
  )),
  risk_factors     TEXT[],
  parameters_json  JSONB,
  disabled         BOOLEAN       NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workflow_governance.workflow_pii_exposure (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id    TEXT          NOT NULL REFERENCES workflow_governance.workflows(id) ON DELETE CASCADE,
  pii_type       TEXT          NOT NULL,
  node_name      TEXT,
  field_location TEXT,
  masked         BOOLEAN       NOT NULL DEFAULT false,
  encrypted      BOOLEAN       NOT NULL DEFAULT false,
  discovered_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workflow_governance.workflow_dependencies (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id      TEXT          NOT NULL REFERENCES workflow_governance.workflows(id) ON DELETE CASCADE,
  dependency_type  TEXT          NOT NULL,
  required         BOOLEAN       NOT NULL DEFAULT true,
  discovered_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wf_risk_score   ON workflow_governance.workflows(risk_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_wf_active       ON workflow_governance.workflows(active);
CREATE INDEX IF NOT EXISTS idx_wf_risk_level   ON workflow_governance.workflows(risk_level);
CREATE INDEX IF NOT EXISTS idx_wf_updated_at   ON workflow_governance.workflows(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_wf_metadata     ON workflow_governance.workflows USING GIN (metadata_json);
CREATE INDEX IF NOT EXISTS idx_wfn_workflow    ON workflow_governance.workflow_nodes(workflow_id);
CREATE INDEX IF NOT EXISTS idx_wfn_gov_type    ON workflow_governance.workflow_nodes(governance_type);
CREATE INDEX IF NOT EXISTS idx_wfp_workflow    ON workflow_governance.workflow_pii_exposure(workflow_id);
CREATE INDEX IF NOT EXISTS idx_wfd_type        ON workflow_governance.workflow_dependencies(dependency_type);
