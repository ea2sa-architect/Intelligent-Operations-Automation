-- EP-306-S13 — snapshot history for discovered-server metadata, so S5's
-- review UI can show what changed between discovery scans. discovery_metadata_json
-- on mcp_servers (017_discovery_import.sql) is overwritten in place on every
-- refresh — this table captures the value *before* each overwrite. Only
-- written when an existing 'discovered' row is refreshed (POST
-- /servers/discovery-import), not on first-ever discovery (nothing to diff
-- against yet) or on an already-tracked server (that path never touches
-- discovery_metadata_json at all).
CREATE TABLE IF NOT EXISTS mcp_governance.discovery_scan_history (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id     UUID        NOT NULL REFERENCES mcp_governance.mcp_servers(id) ON DELETE CASCADE,
  metadata_json JSONB       NOT NULL,
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS discovery_scan_history_server_idx
  ON mcp_governance.discovery_scan_history (server_id, recorded_at DESC);
