-- Platform integration registry
-- Stores one row per configured platform connection (n8n, make, zapier, power_automate).
-- config_json holds platform-specific credentials and settings (api_key, region, tenant_id, etc.)

CREATE TABLE IF NOT EXISTS workflow_governance.platform_connections (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  platform       TEXT        NOT NULL
                             CHECK (platform IN ('n8n', 'zapier', 'make', 'power_automate')),
  name           TEXT        NOT NULL,
  config_json    JSONB       NOT NULL DEFAULT '{}',
  status         TEXT        NOT NULL DEFAULT 'unconfigured'
                             CHECK (status IN ('unconfigured', 'connected', 'error')),
  last_tested_at TIMESTAMPTZ,
  error_message  TEXT,
  workflow_count INT         NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pc_platform ON workflow_governance.platform_connections(platform);
CREATE INDEX IF NOT EXISTS idx_pc_status   ON workflow_governance.platform_connections(status);
