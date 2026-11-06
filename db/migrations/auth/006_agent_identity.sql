-- EP-204-S1 — Agent identity registry: distinct, revocable identities for
-- non-human actors (workflows, AI agents, agent instances, MCP clients/
-- servers, tools), separate from auth.users (human) and auth.api_keys (one
-- static long-lived machine secret). Each agent gets its own short-lived
-- JWT minted on demand (S2) rather than sharing one platform-wide credential
-- — and, unlike an api_key exchange, can be revoked mid-lifetime with that
-- revocation taking effect immediately rather than waiting out the token's
-- own expiry (S3, enforced in every service's require-auth.js).

CREATE TABLE IF NOT EXISTS auth.agents (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT        NOT NULL,
  type          TEXT        NOT NULL CHECK (type IN ('workflow', 'ai_agent', 'agent_instance', 'mcp_client', 'mcp_server', 'tool')),
  owner_user_id UUID        REFERENCES auth.users(id),
  scope         JSONB       NOT NULL DEFAULT '[]',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agents_owner ON auth.agents(owner_user_id);
