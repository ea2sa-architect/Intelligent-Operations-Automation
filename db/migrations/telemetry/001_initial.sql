-- Telemetry schema: time-series metrics via TimescaleDB hypertable

CREATE SCHEMA IF NOT EXISTS telemetry;

CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS telemetry.metrics (
  time         TIMESTAMPTZ   NOT NULL,
  service_name VARCHAR(100)  NOT NULL,
  metric_name  VARCHAR(255)  NOT NULL,
  value        DOUBLE PRECISION NOT NULL,
  labels_json  JSONB         NOT NULL DEFAULT '{}'
);

SELECT create_hypertable(
  'telemetry.metrics',
  'time',
  if_not_exists => TRUE
);

-- Enable columnstore (required before adding a compression policy)
ALTER TABLE telemetry.metrics SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'service_name,metric_name'
);

-- Compress chunks older than 7 days to save storage
SELECT add_compression_policy('telemetry.metrics', INTERVAL '7 days', if_not_exists => TRUE);

-- Drop chunks older than 90 days
SELECT add_retention_policy('telemetry.metrics', INTERVAL '90 days', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_metrics_service_metric
  ON telemetry.metrics(service_name, metric_name, time DESC);

CREATE INDEX IF NOT EXISTS idx_metrics_labels
  ON telemetry.metrics USING GIN (labels_json);
