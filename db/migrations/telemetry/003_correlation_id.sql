-- EP-102-S2 — first-class correlation_id column on telemetry.metrics.
-- Previously only reachable via labels_json->>'correlation_id' (ad hoc,
-- populated only by mcp-governance-service's invocation-event route). A
-- real, indexed column is what makes a correlation-chain lookup
-- (EP-102-S8's drill-down) an index scan instead of a JSONB scan across the
-- whole hypertable, and is the column the platform-wide x-correlation-id
-- header standard (EP-102-S1) now writes to on every ingest.

ALTER TABLE telemetry.metrics ADD COLUMN IF NOT EXISTS correlation_id UUID;

CREATE INDEX IF NOT EXISTS idx_metrics_correlation ON telemetry.metrics (correlation_id, time DESC);
