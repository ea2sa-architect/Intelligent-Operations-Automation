-- Add structured policy logic alongside the human-readable description
ALTER TABLE governance.policies
  ADD COLUMN IF NOT EXISTS logic_json JSONB;

CREATE INDEX IF NOT EXISTS idx_policies_logic
  ON governance.policies USING GIN (logic_json);
