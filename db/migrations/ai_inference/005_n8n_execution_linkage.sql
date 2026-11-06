-- Carries the n8n execution/node identifiers an inference call originated
-- from, when the caller (an n8n workflow's HTTP Request node, via its
-- built-in $execution.id / $node.name expressions) supplies them. Optional
-- and additive — existing callers that don't send these keep working
-- unchanged. Captured at POST / time alongside workflow_id (see
-- 003_genai_telemetry_fields.sql) and merged into the telemetry event at
-- PUT /:id completion, same pattern as every other request-scoped field.
-- This is what lets a Data Lineage "model" node trace back to the exact
-- n8n workflow execution and node that triggered it (see
-- work/epics/e3-lineage-n8n-linkage/).
ALTER TABLE ai_inference.inference_requests
  ADD COLUMN IF NOT EXISTS n8n_execution_id TEXT,
  ADD COLUMN IF NOT EXISTS n8n_node_name    TEXT;
