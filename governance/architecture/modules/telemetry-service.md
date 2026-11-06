---
type: module
name: telemetry-service
purpose: "TimescaleDB-backed metrics/telemetry ingestion (hypertable, auto-compress 7d, auto-drop 90d)"
status: active
depends_on: []
depended_by: ["ai-inference-service", "mcp-governance-service", "web", "workflow-governance-service"]
entry_points: ["services/telemetry-service/index.js"]
components: 12
---

# telemetry-service

## Purpose

TimescaleDB-backed metrics/telemetry ingestion (hypertable, auto-compress 7d, auto-drop 90d)

## Architecture

Port `3304`, Postgres schema `telemetry` (shared TimescaleDB instance, isolated by `search_path`). Reached from outside only through Kong at `/api/{prefix}/*` — see `bootstrap/platform.config.yaml` for the exact route prefix.

Every service imports `src/lib/require-auth.js`, a deliberately duplicated JWT-verification middleware applied globally via `app.use(requireAuth)` (Epic 2, AUTH-201) — except `auth-service` itself, which issues sessions rather than consuming them.

## Key Files

- `services/telemetry-service/src/lib/correlation-id.js` — Request correlation-ID propagation helper
- `services/telemetry-service/src/lib/require-auth.js` — Deliberately duplicated JWT-verification middleware (Epic 2, AUTH-201), applied globally via app.use(requireAuth)
- `services/telemetry-service/src/routes/metrics.js` — Express route handlers
- `services/telemetry-service/swagger.js` — Swagger/OpenAPI spec definition for this service
- `services/telemetry-service/tests/correlation-id.test.js` — Test suite (vitest/supertest)
- `services/telemetry-service/tests/require-auth.test.js` — Test suite (vitest/supertest)

## Dependencies

No outbound service dependencies detected.

Depended on by: `ai-inference-service`, `mcp-governance-service`, `web`, `workflow-governance-service`
