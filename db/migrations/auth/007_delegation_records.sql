-- EP-204-S4 — Delegation chain recording. Every time a credential is issued
-- for an agent (POST /agents/:id/credential), that issuance IS a delegation
-- event: a human (or another already-delegated agent) is lending some slice
-- of their authority to this agent identity. One row per issuance, not per
-- agent — an agent can be delegated to multiple times with different scopes
-- or tools across its lifetime, and each needs its own audit trail (S6).
--
-- tool_id is a loose TEXT reference, not a FK — the tool being delegated for
-- may live in mcp_governance.mcp_tools (a different schema/service) or may
-- not exist as a governed record at all yet. Same loose-coupling convention
-- telemetry.metrics' labels_json already uses for cross-schema references.

CREATE TABLE IF NOT EXISTS auth.delegation_records (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  initiating_user_id  UUID        REFERENCES auth.users(id),
  agent_id            UUID        NOT NULL REFERENCES auth.agents(id),
  tool_id             TEXT,
  authority_scope     JSONB       NOT NULL DEFAULT '[]',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_delegation_records_agent ON auth.delegation_records(agent_id);
CREATE INDEX IF NOT EXISTS idx_delegation_records_initiator ON auth.delegation_records(initiating_user_id);
