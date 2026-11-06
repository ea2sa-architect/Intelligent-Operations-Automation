IOA Governance Platform — Claude Code Context
What this project is
A microservices platform for AI governance: policy enforcement, inference decisions, audit logging, alert escalation, telemetry, and n8n workflow risk governance. All backend infrastructure (Docker, K8s, Kong, database schemas) is code-generated from a single config file — never edit generated files by hand.

The platform includes a React SPA (web/) with full CRUD UI, contextual InfoTips, and an Administration section for managing the tag registry.

For directory layout, service ports/schemas, environment variables, local dev commands, database conventions, tech stack, and current backlog status, see the ioa-platform-reference skill.

Critical rule: config-driven generation
The only file you edit to change ports, replicas, routes, or add/remove services is:

bootstrap/platform.config.yaml

After any change to that file, regenerate everything:

npm run bootstrap

Generated files (do not edit manually): services/_/Dockerfile, services/_/package.json, services/_/index.js, services/_/db.js, k8s/\*_/_.yaml, docker-compose.yml, kong/kong.yaml.

Exception: services/workflow-governance-service/ was bootstrapped then extended by hand. Its index.js, src/routes/, and src/lib/ are all hand-authored and must not be regenerated.

Exception: every service's index.js and package.json are hand-authored (guarded app.listen + export default app so tests/\*.test.js can import the app without binding the port, plus vitest/supertest devDependencies — auth-service additionally carries bcryptjs, jsonwebtoken, and cookie-parser, and an admin-seed startup hook in src/lib/seed-admin.js). All eight are listed in preserveFiles in bootstrap/platform.config.yaml, which the generator respects — re-running npm run bootstrap will not overwrite them.

Every service also imports src/lib/require-auth.js (Epic 2, AUTH-201) — a deliberately duplicated, byte-identical JWT-verification middleware, applied globally via app.use(requireAuth) in every service except workflow-governance-service, whose two n8n-facing webhook routes (POST /workflows/analyze/callback/:job_id, POST /workflows/:id/execution-event) need per-route exemption — see that file's route comments. auth-service itself has no requireAuth — it issues/manages sessions, it doesn't consume them.

Epic 5 (AUTH-501/504) — roles/permissions, superseded by EP-308's named-permission model. auth.roles/auth.permissions/auth.role_permissions/auth.user_roles started as a coarse read/write model (AUTH-501, db/migrations/auth/002_roles.sql) but that blanket `permissions.includes('write')` gate in require-auth.js was removed — none of the 5 named RBAC roles carry the literal string `write`, so it 403'd every mutating request except platform-admin's accidental wildcard pass-through. EP-308 (db/migrations/auth/003_named_roles.sql, 004_extended_permissions.sql, 008_ioa_cli_permissions.sql) replaced it with named, per-action permissions (`mcp:approve`, `policy:edit`, `release:certify`, etc. — canonical list in services/auth-service/src/lib/permissions.js, whose header also documents the role→permission mapping). auth-service resolves a user's effective roles/permissions at login (src/lib/rbac.js's getRolesAndPermissions) and embeds them in the JWT; require-auth.js now only verifies identity + CSRF, and each route that needs authorization applies `requirePermission('<action>')` (src/lib/require-auth.js) itself, checking `req.user.permissions.includes(action)` and 403ing otherwise — including tokens with no permissions claim (empty array), which fail closed, not open. Internal-service-key requests (`isService`) are exempt from requirePermission the same way they're exempt from CSRF.

workflow-governance-service — route mounting order (critical)
app.use('/workflows', analysisRouter); // MUST be first

app.use('/workflows', workflowsRouter); // /:id wildcard here would swallow analysis routes

app.use('/risk', riskRouter);

app.use('/tags', tagsRouter);

analysisRouter handles /workflows/analysis/:job_id and /workflows/analyze/callback/:job_id. These must be registered before workflowsRouter whose /:id route would match them first.

Kong topology
Kong is shared infrastructure that this project does not own or start — bootstrap/generators/compose-generator.js deliberately never emits a kong-gateway service; the generated docker-compose.yml only joins the external kong-net network so the already-running Kong container can reach these services by name.

Kong itself (a DB-backed, Postgres-persisted Kong 3.7, not DB-less) is owned by a sibling project's compose file (not part of this repo). That must be up (docker compose up -d) before anything in this project can reach Kong. It's also where ioa-mcp-enforcement's Lua code gets bind-mounted into the container and KONG_PLUGINS is set — this project's copy under kong-plugins/ioa-mcp-enforcement/ is the canonical source that mount points at directly, not an independent copy.

Two separate, non-conflicting provisioning paths write into that shared Kong:

kong/kong.yaml (generated) + npm run kong:sync (deck gateway sync) — provisions routes for this platform's 8 fixed services. Re-run after any platform.config.yaml route change.
services/mcp-governance-service/src/lib/kong-provisioner.js — live Kong Admin API calls (not declarative sync) that provision a dedicated service + route + ioa-mcp-enforcement plugin instance per MCP server, the moment that server's status transitions to approved.

Danger — deck gateway sync is a full-state sync, not an add/update. Kong is shared with several unrelated services. kong.yaml only lists this platform's 8 services, so running deck gateway sync kong/kong.yaml without --select-tag ioa-governance deletes every one of those other teams' services/routes/plugins — deck treats anything absent from the state file as something to remove. This already happened once (recovered from a deck gateway dump backup taken minutes earlier). npm run kong:sync has --select-tag ioa-governance baked in for exactly this reason — never run deck gateway sync against this instance without a --select-tag scoping it to entities tagged ioa-governance, and take a deck gateway dump backup before any manual deck command against it.

Adding a new backend service
Add an entry to bootstrap/platform.config.yaml under services:.
Create db/migrations/<schema>/001_initial.sql with the schema DDL.
Run npm run bootstrap — all files are generated automatically.
Run npm run migrate to apply the new schema.

Do not hand-author service files for generated services — they will be overwritten.

Compact instructions
When compacting, preserve: which service/file is being actively modified, the exact error or test output currently being debugged, and any decision made this session that isn't yet reflected in this file or the ioa-platform-reference skill. Do not re-summarize static content already covered above (config-driven generation, route mounting order, Kong danger zone) or in the ioa-platform-reference skill (directory layout, ports/schemas, env vars, tech stack) — that's already available on demand.
