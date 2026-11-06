-- Governance schema: policy definitions, rules, bindings, and version history

CREATE SCHEMA IF NOT EXISTS governance;

CREATE TABLE IF NOT EXISTS governance.policies (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  status      VARCHAR(50)  NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'active', 'inactive', 'archived')),
  version     INTEGER      NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS governance.policy_rules (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id      UUID        NOT NULL REFERENCES governance.policies(id) ON DELETE CASCADE,
  condition_json JSONB       NOT NULL,
  action         VARCHAR(100) NOT NULL,
  priority       INTEGER      NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS governance.policy_bindings (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id      UUID        NOT NULL REFERENCES governance.policies(id) ON DELETE CASCADE,
  entity_type    VARCHAR(100) NOT NULL,
  entity_id      VARCHAR(255) NOT NULL,
  effective_from TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  effective_to   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (policy_id, entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS governance.policy_versions (
  id            UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id     UUID     NOT NULL REFERENCES governance.policies(id) ON DELETE CASCADE,
  version       INTEGER  NOT NULL,
  snapshot_json JSONB    NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (policy_id, version)
);

CREATE INDEX IF NOT EXISTS idx_policy_rules_policy_id
  ON governance.policy_rules(policy_id);

CREATE INDEX IF NOT EXISTS idx_policy_bindings_entity
  ON governance.policy_bindings(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_policy_bindings_policy_id
  ON governance.policy_bindings(policy_id);

CREATE INDEX IF NOT EXISTS idx_policy_versions_policy_id
  ON governance.policy_versions(policy_id);
