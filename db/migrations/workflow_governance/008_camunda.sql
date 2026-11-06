-- Extend platform_connections.platform CHECK constraint to include Camunda.
-- PostgreSQL does not support modifying CHECK constraints in place — drop and recreate.

ALTER TABLE workflow_governance.platform_connections
  DROP CONSTRAINT IF EXISTS platform_connections_platform_check;

ALTER TABLE workflow_governance.platform_connections
  ADD CONSTRAINT platform_connections_platform_check
  CHECK (platform IN ('n8n', 'zapier', 'make', 'power_automate', 'camunda'));
