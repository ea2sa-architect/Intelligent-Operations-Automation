-- EP-102-S4/S5/S6/S7 — GenAI-convention context and completion fields.
-- Context fields (prompt_template_version, mcp_server_id/tool_id,
-- data_classification, user_id/service_id, workflow_id,
-- business_transaction_id) are known at request submission (POST /) and
-- persist on the row through to completion (PUT /:id), where they're
-- merged with completion-only metrics (input/output token counts,
-- estimated cost) into one telemetry event forwarded to telemetry-service.
-- No cross-schema FK to mcp_governance/workflow_governance — same
-- loose-reference convention already used elsewhere in this codebase
-- (e.g. mcp-governance-service's telemetry never FKs to workflow_governance).

ALTER TABLE ai_inference.inference_requests
  ADD COLUMN IF NOT EXISTS prompt_template_version   TEXT,
  ADD COLUMN IF NOT EXISTS mcp_server_id              UUID,
  ADD COLUMN IF NOT EXISTS mcp_tool_id                UUID,
  ADD COLUMN IF NOT EXISTS data_classification        TEXT,
  ADD COLUMN IF NOT EXISTS user_id                    TEXT,
  ADD COLUMN IF NOT EXISTS service_id                 TEXT,
  ADD COLUMN IF NOT EXISTS workflow_id                TEXT,
  ADD COLUMN IF NOT EXISTS business_transaction_id    TEXT,
  ADD COLUMN IF NOT EXISTS input_tokens               INTEGER,
  ADD COLUMN IF NOT EXISTS output_tokens              INTEGER,
  ADD COLUMN IF NOT EXISTS estimated_cost_usd          NUMERIC(10,6);

CREATE INDEX IF NOT EXISTS idx_inference_requests_workflow ON ai_inference.inference_requests(workflow_id);
CREATE INDEX IF NOT EXISTS idx_inference_requests_mcp_tool ON ai_inference.inference_requests(mcp_tool_id);
