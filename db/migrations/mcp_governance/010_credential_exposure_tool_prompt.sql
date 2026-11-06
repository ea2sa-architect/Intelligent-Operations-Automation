-- EP-101-S4 — extends credential-exposure tracking to MCP tool and prompt
-- definitions. tools.js and prompts.js never called the credential scanner
-- at all (only servers.js/resources.js did), so a hardcoded secret pasted
-- into a tool description, schema example, or prompt template went
-- undetected. Adds the two missing source_type values plus the FK columns
-- needed to scope findings to a specific tool/prompt (mirrors resource_id).

ALTER TABLE mcp_governance.mcp_credential_exposure
  DROP CONSTRAINT mcp_credential_exposure_source_type_check;

ALTER TABLE mcp_governance.mcp_credential_exposure
  ADD CONSTRAINT mcp_credential_exposure_source_type_check
  CHECK (source_type IN ('server_config', 'resource_uri', 'tool_definition', 'prompt_content'));

ALTER TABLE mcp_governance.mcp_credential_exposure
  ADD COLUMN IF NOT EXISTS tool_id UUID REFERENCES mcp_governance.mcp_tools(id) ON DELETE CASCADE;

ALTER TABLE mcp_governance.mcp_credential_exposure
  ADD COLUMN IF NOT EXISTS prompt_id UUID REFERENCES mcp_governance.mcp_prompts(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_mcp_credential_exposure_tool   ON mcp_governance.mcp_credential_exposure(tool_id);
CREATE INDEX IF NOT EXISTS idx_mcp_credential_exposure_prompt ON mcp_governance.mcp_credential_exposure(prompt_id);
