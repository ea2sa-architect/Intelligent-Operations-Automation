-- Policy bundles (policy-as-code): rules need a stable, human-readable key so
-- an exported bundle can be diffed in Git and re-imported idempotently. Nullable
-- on purpose — rules created before this migration (and legacy condition_json
-- rules) stay unnamed; bundle export synthesizes "<rule_type>-<n>" for them.
-- Uniqueness is per policy and only enforced for named rules.

ALTER TABLE governance.policy_rules
  ADD COLUMN IF NOT EXISTS name TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_policy_rules_policy_name
  ON governance.policy_rules (policy_id, name)
  WHERE name IS NOT NULL;
