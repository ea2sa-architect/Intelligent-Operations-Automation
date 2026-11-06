---
type: module
name: auth-service
purpose: "Identity, credential verification, RS256 JWT issuance, RBAC, API keys, admin/guest seeding"
status: active
depends_on: ["audit-service"]
depended_by: ["web"]
entry_points: ["services/auth-service/index.js"]
components: 34
---

# auth-service

## Purpose

Identity, credential verification, RS256 JWT issuance, RBAC, API keys, admin/guest seeding

## Architecture

Port `3307`, Postgres schema `auth` (shared TimescaleDB instance, isolated by `search_path`). Reached from outside only through Kong at `/api/{prefix}/*` — see `bootstrap/platform.config.yaml` for the exact route prefix.

Every service imports `src/lib/require-auth.js`, a deliberately duplicated JWT-verification middleware applied globally via `app.use(requireAuth)` (Epic 2, AUTH-201) — except `auth-service` itself, which issues sessions rather than consuming them.

## Key Files

- `services/auth-service/src/lib/api-keys.js` — API key issuance/validation (POST /api/auth/api-keys)
- `services/auth-service/src/lib/audit-client.js` — Client for writing compliance events to audit-service
- `services/auth-service/src/lib/jwt.js` — JWT sign/verify helpers
- `services/auth-service/src/lib/permissions.js` — Permission-claim helpers for the coarse read/write model
- `services/auth-service/src/lib/rbac.js` — Role/permission resolution for RBAC (Epic 5, AUTH-501/504)
- `services/auth-service/src/lib/require-auth.js` — Deliberately duplicated JWT-verification middleware (Epic 2, AUTH-201), applied globally via app.use(requireAuth)
- `services/auth-service/src/lib/seed-admin.js` — Idempotent admin/guest account seeding on service startup
- `services/auth-service/src/routes/agents.js` — Express route handlers
- `services/auth-service/src/routes/auth.js` — Express route handlers
- `services/auth-service/swagger.js` — Swagger/OpenAPI spec definition for this service
- `services/auth-service/tests/auth-routes.test.js` — Test suite (vitest/supertest)
- `services/auth-service/tests/require-auth.test.js` — Test suite (vitest/supertest)

## Dependencies

Depends on: `audit-service`

Depended on by: `web`
