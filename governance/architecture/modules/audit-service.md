---
type: module
name: audit-service
purpose: "Append-only compliance event log, range-partitioned by month"
status: active
depends_on: []
depended_by: ["auth-service", "web"]
entry_points: ["services/audit-service/index.js"]
components: 9
---

# audit-service

## Purpose

Append-only compliance event log, range-partitioned by month

## Architecture

Port `3302`, Postgres schema `audit` (shared TimescaleDB instance, isolated by `search_path`). Reached from outside only through Kong at `/api/{prefix}/*` — see `bootstrap/platform.config.yaml` for the exact route prefix.

Every service imports `src/lib/require-auth.js`, a deliberately duplicated JWT-verification middleware applied globally via `app.use(requireAuth)` (Epic 2, AUTH-201) — except `auth-service` itself, which issues sessions rather than consuming them.

## Key Files

- `services/audit-service/src/lib/require-auth.js` — Deliberately duplicated JWT-verification middleware (Epic 2, AUTH-201), applied globally via app.use(requireAuth)
- `services/audit-service/swagger.js` — Swagger/OpenAPI spec definition for this service
- `services/audit-service/tests/require-auth.test.js` — Test suite (vitest/supertest)

## Dependencies

No outbound service dependencies detected.

Depended on by: `auth-service`, `web`
