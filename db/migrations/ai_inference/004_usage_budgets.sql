-- E7-S1.1 — usage budgets: spend/token caps per scope (model, user,
-- service, or workflow), checked by spend-check.js against existing
-- estimated_cost_usd on inference_requests (EP-102). Budgets are opt-in —
-- a scope with no matching row here is simply never checked.
--
-- scope_type/scope_value is an exact-match pair against the corresponding
-- free-text column on inference_requests (model_id, user_id, service_id,
-- workflow_id) — same loose-reference convention migration 003 already
-- established for those columns, not a new entity registry.

CREATE TABLE IF NOT EXISTS ai_inference.usage_budgets (
  id          UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type  VARCHAR(50)    NOT NULL
                CHECK (scope_type IN ('model_id', 'user_id', 'service_id', 'workflow_id')),
  scope_value TEXT           NOT NULL,
  period      VARCHAR(20)    NOT NULL
                CHECK (period IN ('daily', 'monthly')),
  limit_usd   NUMERIC(10,6)  NOT NULL CHECK (limit_usd > 0),
  mode        VARCHAR(10)    NOT NULL DEFAULT 'soft'
                CHECK (mode IN ('soft', 'hard')),
  status      VARCHAR(20)    NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'archived')),
  created_at  TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_budgets_scope
  ON ai_inference.usage_budgets(scope_type, scope_value, status);
