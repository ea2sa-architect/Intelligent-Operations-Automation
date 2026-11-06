-- EP-306-S4 — 'discovered' status for auto-discovered candidates, populated
-- by discovery-agent's scan -> POST /servers/discovery-import, distinct from
-- pending_review (a human has started the formal governance process).
-- last_discovery_at already existed in 001_initial.sql, seemingly built with
-- exactly this feature in mind.

ALTER TABLE mcp_governance.mcp_servers DROP CONSTRAINT mcp_servers_status_check;
ALTER TABLE mcp_governance.mcp_servers ADD CONSTRAINT mcp_servers_status_check
  CHECK (status IN ('discovered', 'pending_review', 'approved', 'rejected', 'retired'));

-- Source/command/args/env-hint metadata from the scan — kept separate from
-- the registry's own fields (endpoint, technical_owner, etc.), which stay
-- NULL on a bare discovery stub until a human actually registers it via the
-- normal POST/PUT flow. Not reused for anything once promoted past
-- 'discovered' — this is discovery provenance, not registry data.
ALTER TABLE mcp_governance.mcp_servers ADD COLUMN IF NOT EXISTS discovery_metadata_json JSONB;

-- Idempotent-on-name guarantee for discovery-import's upsert: at most one
-- 'discovered'-status row per name. Deliberately does NOT constrain
-- non-discovered rows — a server already tracked through the real
-- governance workflow (pending_review or later) must never collide with a
-- fresh discovery candidate of the same name; the route's own lookup
-- handles that case by touching only last_discovery_at, not this index.
CREATE UNIQUE INDEX IF NOT EXISTS mcp_servers_discovered_name_uidx
  ON mcp_governance.mcp_servers (name) WHERE status = 'discovered';
