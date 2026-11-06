-- EP-202-S7/S8 — servers get the same materiality-drift treatment tools
-- already have (definition_hash / last_drift_detected_at, migration 007-ish
-- era): a hash over the fields that actually define what was approved
-- (endpoint, authentication_method, risk_tier, trusted_publisher — transport
-- isn't editable after registration, so it's excluded). NULL for any server
-- that predates this migration — servers.js treats a NULL existing hash as
-- "nothing to compare against yet" rather than a false drift, and backfills
-- it silently on the next PUT.
ALTER TABLE mcp_governance.mcp_servers
  ADD COLUMN IF NOT EXISTS materiality_hash TEXT;
