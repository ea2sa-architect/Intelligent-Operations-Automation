-- Audit schema: append-only compliance event log

CREATE SCHEMA IF NOT EXISTS audit;

CREATE TABLE IF NOT EXISTS audit.audit_events (
  id            UUID        NOT NULL DEFAULT gen_random_uuid(),
  event_type    VARCHAR(100) NOT NULL,
  actor_id      VARCHAR(255) NOT NULL,
  actor_type    VARCHAR(100) NOT NULL,
  resource_type VARCHAR(100) NOT NULL,
  resource_id   VARCHAR(255) NOT NULL,
  action        VARCHAR(100) NOT NULL,
  outcome       VARCHAR(50)  NOT NULL
                  CHECK (outcome IN ('success', 'failure', 'partial')),
  metadata_json JSONB,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Seed partitions: current month and next two months
CREATE TABLE IF NOT EXISTS audit.audit_events_2026_05
  PARTITION OF audit.audit_events
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');

CREATE TABLE IF NOT EXISTS audit.audit_events_2026_06
  PARTITION OF audit.audit_events
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

CREATE TABLE IF NOT EXISTS audit.audit_events_2026_07
  PARTITION OF audit.audit_events
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');

-- Default partition catches anything outside explicit ranges
CREATE TABLE IF NOT EXISTS audit.audit_events_default
  PARTITION OF audit.audit_events DEFAULT;

CREATE INDEX IF NOT EXISTS idx_audit_events_actor
  ON audit.audit_events(actor_id, actor_type);

CREATE INDEX IF NOT EXISTS idx_audit_events_resource
  ON audit.audit_events(resource_type, resource_id);

CREATE INDEX IF NOT EXISTS idx_audit_events_event_type
  ON audit.audit_events(event_type);

CREATE INDEX IF NOT EXISTS idx_audit_events_created_at
  ON audit.audit_events(created_at DESC);
