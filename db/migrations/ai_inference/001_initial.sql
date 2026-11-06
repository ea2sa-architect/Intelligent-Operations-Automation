-- AI inference schema: model registry, inference requests, and governance decisions

CREATE SCHEMA IF NOT EXISTS ai_inference;

CREATE TABLE IF NOT EXISTS ai_inference.models (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(255) NOT NULL,
  version       VARCHAR(100) NOT NULL,
  endpoint      TEXT,
  status        VARCHAR(50)  NOT NULL DEFAULT 'inactive'
                  CHECK (status IN ('inactive', 'active', 'deprecated')),
  metadata_json JSONB,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (name, version)
);

CREATE TABLE IF NOT EXISTS ai_inference.inference_requests (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id       UUID        NOT NULL REFERENCES ai_inference.models(id),
  input_hash     VARCHAR(64) NOT NULL,
  output_json    JSONB,
  latency_ms     INTEGER,
  status         VARCHAR(50) NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'completed', 'failed')),
  error_message  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_inference.decisions (
  id                   UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  inference_request_id UUID           NOT NULL REFERENCES ai_inference.inference_requests(id),
  policy_id            UUID,
  outcome              VARCHAR(100)   NOT NULL,
  confidence           NUMERIC(5, 4)  CHECK (confidence >= 0 AND confidence <= 1),
  reasoning_json       JSONB,
  created_at           TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inference_requests_model_id
  ON ai_inference.inference_requests(model_id);

CREATE INDEX IF NOT EXISTS idx_inference_requests_created_at
  ON ai_inference.inference_requests(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_decisions_inference_request_id
  ON ai_inference.decisions(inference_request_id);

CREATE INDEX IF NOT EXISTS idx_decisions_policy_id
  ON ai_inference.decisions(policy_id);
