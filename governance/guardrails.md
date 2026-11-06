---
type: guardrails
version: "1.0.0"
---

# Guardrails: ioa-governance-platform

---

## Guardrails Activos

### Code Quality

| ID | Level | Guardrail | Verification | Derived from |
|----|-------|-----------|--------------|--------------|
| G-01 | MUST | Never hand-edit generated files (`services/*/Dockerfile`, `services/*/package.json`\*, `services/*/index.js`\*, `services/*/db.js`, `k8s/**`, `docker-compose.yml`, `kong/kong.yaml`) — \*except the hand-authored exceptions listed in `preserveFiles` | manual review | CLAUDE.md — "Critical rule: config-driven generation"; platform-wide, supports RF-01–RF-10 |
| G-02 | MUST | Any change to ports, replicas, routes, or services goes through `bootstrap/platform.config.yaml`, then `npm run bootstrap` | manual review | CLAUDE.md; platform-wide, supports RF-01–RF-10 |
| G-03 | MUST | Every protected service applies `src/lib/require-auth.js` globally via `app.use(requireAuth)` — except `auth-service` (issues sessions, doesn't consume them) and `workflow-governance-service`'s two n8n webhook routes (per-route exempted) | `require-auth.test.js` per service | CLAUDE.md — Epic 2, AUTH-201; enforces RF-08 |
| G-04 | MUST | In `workflow-governance-service`, `analysisRouter` must mount before `workflowsRouter` — the latter's `/:id` wildcard would otherwise swallow `/workflows/analysis/:job_id` and `/workflows/analyze/callback/:job_id` | manual review | CLAUDE.md — "Route mounting order (critical)"; enforces RF-06 |
| G-05 | MUST | Never run `deck gateway sync` against the shared Kong instance without `--select-tag ioa-governance` — an unscoped sync deletes every other team's Kong services/routes/plugins | manual review; `npm run kong:sync` has the tag baked in | CLAUDE.md — "Kong topology" (recovered-from-backup incident); enforces RF-07 |
| G-06 | MUST | Take a `deck gateway dump` backup into `kong-api-gateway/kong/backups/` before any manual `deck` command against the shared Kong instance | manual review | CLAUDE.md — "Kong topology"; enforces RF-07 |
| G-07 | SHOULD | Test command: `npx vitest run` | CI / pre-commit | detected (`rai init --detect`, `.raise/manifest.yaml`); platform-wide, supports RF-01–RF-10 |
| G-08 | SHOULD | Lint command: `npx eslint .` | CI / pre-commit | detected (`rai init --detect`, `.raise/manifest.yaml`); platform-wide, supports RF-01–RF-10 |
| G-09 | SHOULD | Default to no comments in code; only comment non-obvious WHY (hidden constraint, subtle invariant, workaround) | manual review | CLAUDE.md project conventions (observed: 0/787 discovered symbols carry a docstring); platform-wide, supports RF-01–RF-10 |
