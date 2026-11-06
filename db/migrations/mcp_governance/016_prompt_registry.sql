-- EP-303 — Prompt & Agent Governance Registry
-- Distinct from mcp_governance.mcp_prompts (per-server MCP prompts, EP-101).
-- This table governs standalone prompt templates with approval lifecycle,
-- version history, and drift detection.

BEGIN;

CREATE TABLE IF NOT EXISTS mcp_governance.prompt_registry (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    TEXT        NOT NULL UNIQUE,
  type                    TEXT        NOT NULL
    CHECK (type IN ('system', 'template', 'guardrail', 'tool_description')),
  content                 TEXT        NOT NULL,
  content_hash            TEXT        NOT NULL,
  version                 INT         NOT NULL DEFAULT 1,
  owner                   TEXT,
  purpose                 TEXT,
  approved_models         JSONB       NOT NULL DEFAULT '[]',
  permitted_data_classes  JSONB       NOT NULL DEFAULT '[]',
  approval_status         TEXT        NOT NULL DEFAULT 'pending'
    CHECK (approval_status IN ('pending', 'approved', 'denied', 'deprecated')),
  approved_by             TEXT,
  approved_at             TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mcp_governance.prompt_registry_versions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_id    UUID        NOT NULL
    REFERENCES mcp_governance.prompt_registry(id) ON DELETE CASCADE,
  version      INT         NOT NULL,
  content      TEXT        NOT NULL,
  content_hash TEXT        NOT NULL,
  changed_by   TEXT,
  changed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_prompt_registry_versions_prompt_version
  ON mcp_governance.prompt_registry_versions(prompt_id, version);

CREATE INDEX IF NOT EXISTS idx_prompt_registry_status
  ON mcp_governance.prompt_registry(approval_status);

CREATE INDEX IF NOT EXISTS idx_prompt_registry_type
  ON mcp_governance.prompt_registry(type);

COMMIT;
