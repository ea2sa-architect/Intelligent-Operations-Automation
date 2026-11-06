// EP-308-S2/S4 — Named permission constants.
// These are the canonical names stored in auth.permissions and embedded in JWTs.
// Use these constants in requirePermission() calls rather than raw strings.
//
// Role → permissions mapping (defined in db/migrations/auth/003_named_roles.sql,
// db/migrations/auth/004_extended_permissions.sql,
// db/migrations/auth/008_ioa_cli_permissions.sql,
// db/migrations/auth/009_workflow_manage_permission.sql, and
// db/migrations/auth/010_policy_import_permission.sql):
//   platform-admin    : all
//   governance-officer: mcp:read/register/approve, policy:read/edit/import, violation:resolve, waiver:grant, audit:read, workflow:read, incident:manage, inference:manage, workflow:execution-approve, release:certify
//   security-reviewer : mcp:read/register, policy:read, audit:read, workflow:read
//   business-owner    : mcp:read/register, policy:read, workflow:read
//   auditor           : mcp:read, policy:read, audit:read, workflow:read
//
// telemetry:write and audit:write are granted to no named role — those routes
// are service-to-service ingestion that authenticates via INTERNAL_SERVICE_KEY
// and bypasses requirePermission (see its isService check), not human-driven.
//
// workflow:manage is granted to no named role except platform-admin —
// deliberately not bundled into workflow:read (held by auditor/
// business-owner too), since it gates bulk-destructive actions
// (DELETE /workflows).

export const PERMISSIONS = {
  MCP_READ:           'mcp:read',
  MCP_REGISTER:       'mcp:register',
  MCP_APPROVE:        'mcp:approve',
  POLICY_READ:        'policy:read',
  POLICY_EDIT:        'policy:edit',
  POLICY_IMPORT:      'policy:import',
  VIOLATION_RESOLVE:  'violation:resolve',
  WAIVER_GRANT:       'waiver:grant',
  AUDIT_READ:         'audit:read',
  AUDIT_WRITE:        'audit:write',
  WORKFLOW_READ:      'workflow:read',
  WORKFLOW_MANAGE:    'workflow:manage',
  USER_MANAGE:        'user:manage',
  INCIDENT_MANAGE:    'incident:manage',
  INFERENCE_MANAGE:   'inference:manage',
  TELEMETRY_WRITE:    'telemetry:write',
  WORKFLOW_EXECUTION_APPROVE: 'workflow:execution-approve',
  RELEASE_CERTIFY:            'release:certify',
};
