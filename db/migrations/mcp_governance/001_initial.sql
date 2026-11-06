-- MCP governance schema: registry foundation (M0).
-- v1 is manual-registration only — nothing here is auto-discovered from
-- arbitrary MCP hosts yet. A row existing in mcp_servers means someone
-- registered it; "status" tracks the approval workflow from there.
-- Anything referenced elsewhere (e.g. a workflow's MCP-client node, added in
-- a later increment) that has NO row here is what "unregistered" actually means.

CREATE SCHEMA IF NOT EXISTS mcp_governance;

CREATE TABLE IF NOT EXISTS mcp_governance.mcp_servers (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT          NOT NULL,
  version               TEXT,
  publisher             TEXT,
  source_repository     TEXT,
  transport             TEXT          NOT NULL CHECK (transport IN ('local', 'remote')),
  endpoint              TEXT,
  protocol_version      TEXT,
  authentication_method TEXT,
  hosting_environment   TEXT          CHECK (hosting_environment IN ('development', 'test', 'production')),
  deployment_location   TEXT,
  technical_owner       TEXT,
  business_owner        TEXT,
  approved_use_case     TEXT,
  data_classification   TEXT,
  downstream_systems    TEXT[],
  risk_tier             TEXT          CHECK (risk_tier IN ('low', 'moderate', 'high', 'critical')),
  status                TEXT          NOT NULL DEFAULT 'pending_review'
                                       CHECK (status IN ('pending_review', 'approved', 'rejected', 'retired')),
  approved_version      TEXT,
  configuration_hash    TEXT,
  trusted_publisher     BOOLEAN       NOT NULL DEFAULT false,
  dependencies_json     JSONB         DEFAULT '[]',
  integrity_info        TEXT,
  last_discovery_at     TIMESTAMPTZ,
  review_date           TIMESTAMPTZ,
  expiration_date       TIMESTAMPTZ,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mcp_governance.mcp_clients (
  id                     UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   TEXT          NOT NULL,
  client_type            TEXT          CHECK (client_type IN
                                       ('claude_desktop', 'ide', 'agent', 'n8n_workflow', 'custom_application', 'other')),
  identity               TEXT,
  environment            TEXT          CHECK (environment IN ('development', 'test', 'production')),
  approval_configuration JSONB         DEFAULT '{}',
  created_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Which servers a client connects to, and what's enabled for that pairing —
-- a client may be approved for one server's capabilities but not another's.
CREATE TABLE IF NOT EXISTS mcp_governance.mcp_client_servers (
  client_id            UUID          NOT NULL REFERENCES mcp_governance.mcp_clients(id) ON DELETE CASCADE,
  server_id            UUID          NOT NULL REFERENCES mcp_governance.mcp_servers(id) ON DELETE CASCADE,
  enabled_capabilities TEXT[],
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  PRIMARY KEY (client_id, server_id)
);

CREATE TABLE IF NOT EXISTS mcp_governance.mcp_tools (
  id                     UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id              UUID          NOT NULL REFERENCES mcp_governance.mcp_servers(id) ON DELETE CASCADE,
  name                   TEXT          NOT NULL,
  description            TEXT,
  input_schema_json      JSONB,
  output_schema_json     JSONB,
  behavior               TEXT          CHECK (behavior IN ('read', 'write')),
  downstream_systems     TEXT[],
  required_scopes        TEXT[],
  destructive            BOOLEAN       NOT NULL DEFAULT false,
  external_communication BOOLEAN       NOT NULL DEFAULT false,
  privilege_level        TEXT          CHECK (privilege_level IN ('low', 'moderate', 'high', 'critical')),
  -- T0 (log & allow) .. T4 (prohibit / break-glass only) — see the source
  -- document's tool-class table. Classification and allowlisting logic land
  -- in a later increment; the column exists now so it's ready.
  classification         TEXT          CHECK (classification IN ('T0', 'T1', 'T2', 'T3', 'T4')),
  approval_status        TEXT          NOT NULL DEFAULT 'pending'
                                       CHECK (approval_status IN ('pending', 'allowed', 'denied')),
  definition_hash        TEXT,
  version                TEXT,
  created_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (server_id, name)
);

CREATE TABLE IF NOT EXISTS mcp_governance.mcp_resources (
  id                     UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id              UUID          NOT NULL REFERENCES mcp_governance.mcp_servers(id) ON DELETE CASCADE,
  uri_template           TEXT          NOT NULL,
  data_classification    TEXT,
  data_owner             TEXT,
  sensitivity            TEXT          CHECK (sensitivity IN ('public', 'internal', 'confidential', 'restricted')),
  tenant_boundary        TEXT,
  access_conditions      TEXT,
  retention_requirements TEXT,
  created_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mcp_governance.mcp_prompts (
  id                     UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id              UUID          NOT NULL REFERENCES mcp_governance.mcp_servers(id) ON DELETE CASCADE,
  name                   TEXT          NOT NULL,
  content_hash           TEXT,
  version                TEXT,
  source                 TEXT,
  embedded_instructions  TEXT,
  tool_references        TEXT[],
  privilege_implications TEXT,
  approval_status        TEXT          NOT NULL DEFAULT 'pending'
                                       CHECK (approval_status IN ('pending', 'allowed', 'denied')),
  created_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mcp_governance.mcp_authorizations (
  id                             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id                      UUID          NOT NULL REFERENCES mcp_governance.mcp_servers(id) ON DELETE CASCADE,
  identity_type                  TEXT          CHECK (identity_type IN ('user_delegated', 'workload')),
  identity_reference             TEXT,
  oauth_audience                 TEXT,
  scopes                         TEXT[],
  token_issuer                   TEXT,
  resource_server                TEXT,
  token_expiration_seconds       INTEGER,
  token_binding_method           TEXT,
  refresh_capable                BOOLEAN       NOT NULL DEFAULT false,
  downstream_credential_exchange BOOLEAN       NOT NULL DEFAULT false,
  -- Automatic-critical-violation territory per the source document — worth
  -- capturing now even though the ceiling enforcement is a later increment.
  token_passthrough_detected     BOOLEAN       NOT NULL DEFAULT false,
  created_at                     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mcp_servers_status      ON mcp_governance.mcp_servers(status);
CREATE INDEX IF NOT EXISTS idx_mcp_servers_name         ON mcp_governance.mcp_servers(name);
CREATE INDEX IF NOT EXISTS idx_mcp_tools_server         ON mcp_governance.mcp_tools(server_id);
CREATE INDEX IF NOT EXISTS idx_mcp_tools_approval       ON mcp_governance.mcp_tools(approval_status);
CREATE INDEX IF NOT EXISTS idx_mcp_resources_server     ON mcp_governance.mcp_resources(server_id);
CREATE INDEX IF NOT EXISTS idx_mcp_prompts_server       ON mcp_governance.mcp_prompts(server_id);
CREATE INDEX IF NOT EXISTS idx_mcp_authorizations_server ON mcp_governance.mcp_authorizations(server_id);
CREATE INDEX IF NOT EXISTS idx_mcp_client_servers_server ON mcp_governance.mcp_client_servers(server_id);
