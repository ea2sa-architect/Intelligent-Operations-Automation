-- Add service_name and details for shadow-AI audit narrative
ALTER TABLE audit.audit_events
  ADD COLUMN IF NOT EXISTS service_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS details      JSONB;

CREATE INDEX IF NOT EXISTS idx_audit_events_service_name
  ON audit.audit_events(service_name);
