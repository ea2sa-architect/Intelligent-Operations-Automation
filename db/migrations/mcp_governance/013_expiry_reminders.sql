-- EP-202-S6 — dedupes reminder escalations across reaper ticks: the reaper
-- re-queries "servers within N days of expiring" on every run, which would
-- otherwise re-fire the same reminder every tick for however long the
-- server stays inside that window. A unique (server_id, threshold_days) row
-- inserted via ON CONFLICT DO NOTHING is the idempotency check — if the
-- insert returns no row, that reminder already went out.
CREATE TABLE IF NOT EXISTS mcp_governance.expiry_reminders_sent (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id      UUID        NOT NULL REFERENCES mcp_governance.mcp_servers(id) ON DELETE CASCADE,
  threshold_days INT         NOT NULL CHECK (threshold_days IN (30, 7, 1)),
  sent_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (server_id, threshold_days)
);
