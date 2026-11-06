# Permissions Matrix

EP-308-S4 (IOAGP-18) — every mutating route (`POST`/`PUT`/`PATCH`/`DELETE`) across all
8 services, annotated with the named permission (`db/migrations/auth/003_named_roles.sql`,
`db/migrations/auth/004_extended_permissions.sql`) it requires. Permission constants live in
`services/auth-service/src/lib/permissions.js`.

Routes without a permission column are deliberate service-to-service exemptions —
authenticated via the shared `INTERNAL_SERVICE_KEY` (which `requirePermission` bypasses
outright, see its `isService` check), not a browser session. Each is commented in place
where it lives in the code.

## Role → permission grants

| Role                 | Permissions |
|----------------------|-------------|
| `platform-admin`     | all |
| `governance-officer` | `mcp:read/register/approve`, `policy:read/edit/import`, `violation:resolve`, `waiver:grant`, `audit:read`, `workflow:read`, `incident:manage`, `inference:manage` |
| `security-reviewer`  | `mcp:read/register`, `policy:read`, `audit:read`, `workflow:read` |
| `business-owner`     | `mcp:read/register`, `policy:read`, `workflow:read` |
| `auditor`            | `mcp:read`, `policy:read`, `audit:read`, `workflow:read` |

`audit:write` and `telemetry:write` are granted to no named role except `platform-admin` —
both gate service-to-service ingestion routes that authenticate via `INTERNAL_SERVICE_KEY`
and never need a human grant.

## governance-service

| Route | Permission |
|---|---|
| `POST /policies`, `PUT /policies/:id`, `PATCH /policies/:id/status`, `PATCH /policies/:id/enforcement-mode`, `DELETE /policies/:id`, `POST /policies/:id/rules`, `DELETE /policies/:id/rules/:ruleId`, `POST /policies/:id/bindings`, `DELETE /policies/:id/bindings/:bindingId` | `policy:edit` |
| `POST /policy-bundles/import` | `policy:import` (plus `policy:edit` when `on_conflict` is `replace`, checked in the handler) |
| `GET /policy-bundles/export`, `POST /policy-bundles/validate` (read-only: validate is a dry run) | `policy:read` |
| `POST /violations/evaluate`, `PATCH /violations/:id/status`, `PATCH /violations/:id/acknowledge`, `PATCH /violations/:id/remediating`, `PATCH /violations/:id/resolve` | `violation:resolve` |
| `POST /violations/agent-security-event` | `violation:resolve` *(EP-204-S7/S8 — called by require-auth.js's requirePermission and mcp-governance-service's confused-deputy check via `INTERNAL_SERVICE_KEY`, which bypasses this same permission check)* |
| `POST /violations/:id/waivers`, `PATCH /violations/waivers/:id/approve` | `waiver:grant` |
| `POST /approval-decisions` | `mcp:approve` |
| `POST /approval-chains/requests` | `mcp:register` |
| `POST /approval-chains/requests/:id/decisions` | `mcp:approve` |
| `POST /approval-chains`, `PATCH /approval-chains/:id/status` | `policy:edit` |
| `POST /containment/:type/:id/suspend`, `.../quarantine`, `.../restore`, `.../read-only`, `.../rollback` | `violation:resolve` |
| `POST /enforcement` | *(none — Kong/n8n decision endpoint, see comment in `routes/enforcement.js`)* |

## mcp-governance-service

| Route | Permission |
|---|---|
| `POST /servers`, `PUT /servers/:id`, `POST /servers/:id/score` | `mcp:register` |
| `POST /servers/discovery-import` | `mcp:register` |
| `PATCH /servers/:id/status`, `DELETE /servers/:id` | `mcp:approve` |
| `POST /servers/:id/approval-chain-decided`, `POST /servers/:id/containment` | *(none — service-to-service, see comments)* |
| `POST /clients`, `PUT /clients/:id/servers/:serverId`, `DELETE /clients/:id/servers/:serverId`, `DELETE /clients/:id` | `mcp:register` |
| `PATCH /credential-exposure/:id/confirm-rotation` | `violation:resolve` |
| `POST /prompt-registry`, `POST /prompt-registry/check-drift`, `PUT /prompt-registry/:id`, `POST /prompt-registry/:id/rollback/:version` | `mcp:register` |
| `PATCH /prompt-registry/:id/approval` | `mcp:approve` |
| `POST /servers/:serverId/prompts`, `DELETE /prompts/:id` | `mcp:register` |
| `PATCH /prompts/:id/approval` | `mcp:approve` |
| `POST /redaction-patterns`, `PATCH /redaction-patterns/:id`, `DELETE /redaction-patterns/:id` | `policy:edit` |
| `POST /servers/:serverId/resources`, `PUT /resources/:id`, `DELETE /resources/:id` | `mcp:register` |
| `POST /tools/:id/invocation-event` | `telemetry:write` |
| `POST /servers/:serverId/tools`, `PUT /tools/:id`, `DELETE /tools/:id`, `POST /tools/:id/rollback` | `mcp:register` |
| `PATCH /tools/:id/approval`, `POST /tools/:id/containment` | `mcp:approve` |

## workflow-governance-service

| Route | Permission |
|---|---|
| `POST /workflows/:id/analyze` | `workflow:read` |
| `PATCH /workflows/secret-exposure/:id/confirm-rotation` | `violation:resolve` |
| `POST /workflows/discover`, `POST /workflows/import`, `POST /workflows/:id/score`, `PATCH /workflows/:id/ownership`, `POST /workflows/:id/policies/apply` | `workflow:read` |
| `POST /workflows/:id/containment` | `violation:resolve` |
| `POST /workflows/:id/execution-event`, `POST /workflows/:id/enforcement-check`, `POST /workflows/analyze/callback/:job_id` | *(none — n8n webhook/execution paths, pre-existing exemptions)* |
| `POST /assurance` | `workflow:read` |
| `POST /platforms`, `PUT /platforms/:id`, `DELETE /platforms/:id`, `POST /platforms/:id/test` | `workflow:read` |
| `POST /tags`, `PUT /tags/:id`, `DELETE /tags/:id` | `policy:edit` |
| `POST /lineage/build` | `workflow:read` |
| `POST /lineage/ingest` | `telemetry:write` |
| `POST /anomaly/baselines/:workflow_id/compute`, `PATCH /anomaly/alerts/:id`, `POST /anomaly/score` | `workflow:read` |
| `POST /attack-paths/rebuild`, `POST /attack-paths/rebuild/:mcp_server_id` | `workflow:read` |

`anomaly.js`, `attack-paths.js`, and `lineage.js` previously had **no auth middleware at
all** — a pre-existing gap unrelated to fine-grained permissions, fixed alongside this
story by adding router-level `requireAuth` (same pattern as `tags.js`/`assurance.js`).

## escalation-service

| Route | Permission |
|---|---|
| `POST /incidents`, `PATCH /incidents/:id/status`, `POST /incidents/:id/log` | `incident:manage` |
| `POST /rules`, `PUT /rules/:id`, `DELETE /rules/:id` | `incident:manage` |

## ai-inference-service

| Route | Permission |
|---|---|
| `POST /`, `PUT /:id`, `POST /:id/decisions` (inference.js) | `inference:manage` |
| `POST /models`, `PATCH /models/:id/status` | `inference:manage` |

## auth-service

| Route | Permission |
|---|---|
| `POST /login`, `POST /logout` | *(none — issues the session itself)* |
| `POST /users`, `PATCH /users/:id/roles`, `DELETE /users/:id`, `PATCH /users/:id/enable`, `PATCH /users/:id/password` | `user:manage` |
| `PATCH /me/password` | *(none — requires the caller's own current password instead)* |
| `GET /api-keys`, `POST /api-keys`, `DELETE /api-keys/:id` | `user:manage` |
| `POST /api-keys/exchange` | *(none — the raw API key is its own credential, same as `/login` taking a password)* |
| `GET /agents`, `POST /agents`, `DELETE /agents/:id`, `POST /agents/:id/credential` | `user:manage` |
| `GET /delegations` | `user:manage` |

EP-204-S3 gives agent-issued tokens (`sub` prefixed `agent:`) one property no other
token type in this matrix has: revocation takes effect immediately. Every service's
`requireAuth` checks `auth.agents.revoked_at`/`expires_at` live on the hot path for
that one sub shape — a DB round trip only agent tokens pay, not human sessions or
api-key-exchanged tokens, both of which still just run out their own TTL naturally.

EP-306-S12 also added `Authorization: Bearer <jwt>` as an alternative to the session
cookie on every service's `requireAuth` (for non-browser clients like the discovery-agent
CLI, which exchanges an API key for a short-lived 15-minute JWT here and then uses it via
the Bearer header everywhere else). CSRF only applies to the cookie path — a Bearer token
requires explicit header-setting code a malicious page can't do cross-origin, same
reasoning as the existing `INTERNAL_SERVICE_KEY` exemption. This doesn't change any
row in this matrix — it only widens where the token can come from, not what
`requirePermission` checks once it's verified.

## telemetry-service

| Route | Permission |
|---|---|
| `POST /metrics` | `telemetry:write` |

## audit-service

| Route | Permission |
|---|---|
| `POST /events` | `audit:write` |
