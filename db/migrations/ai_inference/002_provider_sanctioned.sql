-- Add provider identity and sanctioned flag to the model registry
ALTER TABLE ai_inference.models
  ADD COLUMN IF NOT EXISTS provider     VARCHAR(255),
  ADD COLUMN IF NOT EXISTS is_sanctioned BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_models_provider
  ON ai_inference.models(provider);

CREATE INDEX IF NOT EXISTS idx_models_sanctioned
  ON ai_inference.models(is_sanctioned);
