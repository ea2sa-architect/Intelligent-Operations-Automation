-- Escalation schema: rules engine, incident lifecycle, and notification log

CREATE SCHEMA IF NOT EXISTS escalation;

CREATE TABLE IF NOT EXISTS escalation.escalation_rules (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name           VARCHAR(255) NOT NULL UNIQUE,
  condition_json JSONB        NOT NULL,
  severity       VARCHAR(50)  NOT NULL
                   CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  channels_json  JSONB        NOT NULL DEFAULT '[]',
  enabled        BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS escalation.incidents (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id         UUID        REFERENCES escalation.escalation_rules(id),
  title           VARCHAR(500) NOT NULL,
  severity        VARCHAR(50)  NOT NULL
                    CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status          VARCHAR(50)  NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'acknowledged', 'resolved', 'closed')),
  context_json    JSONB,
  triggered_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ,
  resolved_at     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS escalation.escalation_log (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id  UUID        NOT NULL REFERENCES escalation.incidents(id) ON DELETE CASCADE,
  channel      VARCHAR(100) NOT NULL,
  recipient    VARCHAR(255) NOT NULL,
  message_json JSONB,
  status       VARCHAR(50)  NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'sent', 'failed')),
  sent_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incidents_rule_id
  ON escalation.incidents(rule_id);

CREATE INDEX IF NOT EXISTS idx_incidents_status
  ON escalation.incidents(status);

CREATE INDEX IF NOT EXISTS idx_incidents_triggered_at
  ON escalation.incidents(triggered_at DESC);

CREATE INDEX IF NOT EXISTS idx_escalation_log_incident_id
  ON escalation.escalation_log(incident_id);
