---
type: module
name: mcp-governance-service
purpose: "MCP server/tool/resource registry: risk scoring, live Kong provisioning on approval, credential scanning, prompt registry"
status: active
depends_on: ["governance-service", "escalation-service", "telemetry-service"]
depended_by: ["discovery-agent", "governance-service", "web", "workflow-governance-service"]
entry_points: ["services/mcp-governance-service/index.js"]
components: 65
---

# mcp-governance-service

## Purpose

MCP server/tool/resource registry: risk scoring, live Kong provisioning on approval, credential scanning, prompt registry

## Architecture

Port `3306`, Postgres schema `mcp_governance` (shared TimescaleDB instance, isolated by `search_path`). Reached from outside only through Kong at `/api/{prefix}/*` — see `bootstrap/platform.config.yaml` for the exact route prefix.

Every service imports `src/lib/require-auth.js`, a deliberately duplicated JWT-verification middleware applied globally via `app.use(requireAuth)` (Epic 2, AUTH-201) — except `auth-service` itself, which issues sessions rather than consuming them.

## Key Files

- `services/mcp-governance-service/src/lib/approval-expiration-reaper.js` — Background reaper: orphan/expired job recovery on startup + interval sweep
- `services/mcp-governance-service/src/lib/assurance-reaper.js` — Background reaper: orphan/expired job recovery on startup + interval sweep
- `services/mcp-governance-service/src/lib/correlation-id.js` — Request correlation-ID propagation helper
- `services/mcp-governance-service/src/lib/credential-scanner.js` — Scans MCP server configs for exposed credentials
- `services/mcp-governance-service/src/lib/escalation-client.js` — Client for filing incidents with escalation-service
- `services/mcp-governance-service/src/lib/expiry-reminder-reaper.js` — Background reaper: orphan/expired job recovery on startup + interval sweep
- `services/mcp-governance-service/src/lib/governance-client.js` — Client for querying governance-service (policy/rule evaluation)
- `services/mcp-governance-service/src/lib/kong-provisioner.js` — Live Kong Admin API calls to provision service+route+plugin per approved MCP server
- `services/mcp-governance-service/src/lib/mcp-risk-scorer.js` — Computes workflow/node risk scores
- `services/mcp-governance-service/src/lib/redaction-config.js` — MCP server registry: risk scoring, Kong provisioning, credential scanning, prompt registry
- `services/mcp-governance-service/src/lib/require-auth.js` — Deliberately duplicated JWT-verification middleware (Epic 2, AUTH-201), applied globally via app.use(requireAuth)
- `services/mcp-governance-service/src/lib/telemetry-client.js` — Client for emitting telemetry events to telemetry-service
- `services/mcp-governance-service/src/routes/prompt-registry.js` — Express route handlers
- `services/mcp-governance-service/src/routes/prompts.js` — Express route handlers
- `services/mcp-governance-service/src/routes/redaction-patterns.js` — Express route handlers
- `services/mcp-governance-service/src/routes/resources.js` — Express route handlers
- `services/mcp-governance-service/src/routes/servers.js` — Express route handlers
- `services/mcp-governance-service/src/routes/tools.js` — Express route handlers
- `services/mcp-governance-service/swagger.js` — Swagger/OpenAPI spec definition for this service
- `services/mcp-governance-service/tests/correlation-id.test.js` — Test suite (vitest/supertest)
- `services/mcp-governance-service/tests/mcp-risk-scorer.test.js` — Test suite (vitest/supertest)
- `services/mcp-governance-service/tests/require-auth.test.js` — Test suite (vitest/supertest)

## Dependencies

Depends on: `governance-service`, `escalation-service`, `telemetry-service`

Depended on by: `discovery-agent`, `governance-service`, `web`, `workflow-governance-service`
