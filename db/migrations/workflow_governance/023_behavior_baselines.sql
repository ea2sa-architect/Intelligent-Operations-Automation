-- EP-305-S1/S2/S3: Behavioral baseline per workflow (computed from last 30 days
-- of telemetry) and anomaly_alerts for detected deviations per execution chain.

CREATE TABLE IF NOT EXISTS workflow_governance.behavior_baselines (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id            TEXT        NOT NULL REFERENCES workflow_governance.workflows(id) ON DELETE CASCADE,
  typical_tool_sequence  JSONB       NOT NULL DEFAULT '[]',
  known_tools            JSONB       NOT NULL DEFAULT '[]',
  known_destinations     JSONB       NOT NULL DEFAULT '[]',
  avg_latency_ms         NUMERIC,
  p95_latency_ms         NUMERIC,
  stddev_latency_ms      NUMERIC,
  avg_node_count         NUMERIC,
  max_loop_depth         INT         NOT NULL DEFAULT 0,
  sample_count           INT         NOT NULL DEFAULT 0,
  computed_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT behavior_baselines_workflow_id_key UNIQUE (workflow_id)
);

CREATE TABLE IF NOT EXISTS workflow_governance.anomaly_alerts (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id      TEXT        NOT NULL REFERENCES workflow_governance.workflows(id) ON DELETE CASCADE,
  correlation_id   TEXT        NOT NULL,
  alert_type       TEXT        NOT NULL CHECK (alert_type IN (
                     'unexpected_tool','excessive_loop','unusual_volume',
                     'new_destination','latency_spike')),
  deviation_score  NUMERIC,
  details_json     JSONB       NOT NULL DEFAULT '{}',
  severity         TEXT        NOT NULL CHECK (severity IN ('low','medium','high','critical')) DEFAULT 'medium',
  status           TEXT        NOT NULL CHECK (status IN ('open','acknowledged','resolved'))   DEFAULT 'open',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS anomaly_alerts_workflow_id_idx    ON workflow_governance.anomaly_alerts (workflow_id);
CREATE INDEX IF NOT EXISTS anomaly_alerts_correlation_id_idx ON workflow_governance.anomaly_alerts (correlation_id);
CREATE INDEX IF NOT EXISTS anomaly_alerts_status_idx         ON workflow_governance.anomaly_alerts (status) WHERE status <> 'resolved';
CREATE INDEX IF NOT EXISTS anomaly_alerts_created_at_idx     ON workflow_governance.anomaly_alerts (created_at DESC);
