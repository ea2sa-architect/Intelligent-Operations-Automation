---
type: module
name: escalation-service
purpose: "Escalation rules engine, incident lifecycle, notification log"
status: active
depends_on: []
depended_by: ["mcp-governance-service", "web", "ai-inference-service"]
entry_points: ["services/escalation-service/index.js"]
components: 9
---

# escalation-service

## Purpose

Escalation rules engine, incident lifecycle, notification log

## Architecture

Port `3303`, Postgres schema `escalation` (shared TimescaleDB instance, isolated by `search_path`). Reached from outside only through Kong at `/api/{prefix}/*` — see `bootstrap/platform.config.yaml` for the exact route prefix.

Every service imports `src/lib/require-auth.js`, a deliberately duplicated JWT-verification middleware applied globally via `app.use(requireAuth)` (Epic 2, AUTH-201) — except `auth-service` itself, which issues sessions rather than consuming them.

## Key Files

- `services/escalation-service/src/lib/require-auth.js` — Deliberately duplicated JWT-verification middleware (Epic 2, AUTH-201), applied globally via app.use(requireAuth)
- `services/escalation-service/swagger.js` — Swagger/OpenAPI spec definition for this service
- `services/escalation-service/tests/require-auth.test.js` — Test suite (vitest/supertest)

## Dependencies

No outbound service dependencies detected.

Depended on by: `mcp-governance-service`, `web`, `ai-inference-service` (E7-S1.3, budget-breach escalation)
