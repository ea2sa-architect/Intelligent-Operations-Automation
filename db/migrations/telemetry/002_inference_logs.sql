-- Dedicated hypertable for per-inference analytics (cost, latency, token usage)
CREATE TABLE IF NOT EXISTS telemetry.inference_logs (
  time        TIMESTAMPTZ      NOT NULL,
  model_name  VARCHAR(255)     NOT NULL,
  token_count INTEGER          NOT NULL,
  cost_usd    DOUBLE PRECISION NOT NULL,
  success     BOOLEAN          NOT NULL DEFAULT true,
  duration_ms INTEGER          NOT NULL
);

SELECT create_hypertable(
  'telemetry.inference_logs',
  'time',
  if_not_exists => TRUE
);

ALTER TABLE telemetry.inference_logs SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'model_name'
);

SELECT add_compression_policy('telemetry.inference_logs', INTERVAL '7 days',  if_not_exists => TRUE);
SELECT add_retention_policy(  'telemetry.inference_logs', INTERVAL '90 days', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_inference_logs_model
  ON telemetry.inference_logs(model_name, time DESC);
