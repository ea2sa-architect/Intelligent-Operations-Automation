-- EP-302-S5 — add control-test evidence types to assurance_evidence
-- These four types are written by the control test runner (governance-service)
-- when a test passes, with confidence_level = 'control_tested'.

BEGIN;

ALTER TABLE workflow_governance.assurance_evidence
  DROP CONSTRAINT IF EXISTS assurance_evidence_evidence_type_check;

ALTER TABLE workflow_governance.assurance_evidence
  ADD CONSTRAINT assurance_evidence_evidence_type_check
  CHECK (evidence_type IN (
    -- workflow-level (manual attestation)
    'workflow_export_verified',
    'database_backup_verified',
    'restore_test_passed',
    'credential_recovery_verified',
    'runbook_available',
    'manual_fallback_tested',
    'dependency_backup_verified',
    -- platform-level (automated collectors, EP-301)
    'api_gateway_health',
    'database_health',
    'n8n_platform_health',
    'container_health',
    -- control-tested (EP-302 runner)
    'access_control_verified',
    'telemetry_correlation_verified',
    'gateway_routing_verified',
    'rate_limiting_verified'
  ));

COMMIT;
