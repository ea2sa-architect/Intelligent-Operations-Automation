---
type: architecture_design
project: "ioa-governance-platform"
status: active
layers:
  - name: services
    modules: [governance-service, ai-inference-service, audit-service, escalation-service, telemetry-service, workflow-governance-service, mcp-governance-service, auth-service, api-docs]
  - name: web
    modules: [web]
  - name: packages
    modules: [ioa-cli, discovery-agent]
  - name: bootstrap
    modules: [bootstrap]
  - name: db
    modules: [db]
  - name: workflows
    modules: [workflows]
---

# System Design: ioa-governance-platform

> C4 Level 2 — Container/component decomposition

## Architecture Overview

Nine Express services share one Postgres/TimescaleDB instance, each isolated
by schema (`db.js` sets `search_path` per service). All backend
infrastructure — Dockerfiles, package.json, index.js stubs, k8s manifests,
docker-compose.yml, kong.yaml — is generated from `bootstrap/platform.config.yaml`
by `npm run bootstrap`; a documented set of files per service (auth-service,
workflow-governance-service, mcp-governance-service, and every service's
`index.js`/`package.json`) are hand-authored exceptions listed in
`preserveFiles`. A React SPA (`web/`) and a developer CLI (`packages/ioa-cli/`)
are the two client surfaces, both talking to every service exclusively
through Kong's `/api/*` proxy — never directly to a service port outside
local dev.

## Components

| Component | Responsibility | Technology |
|-----------|---------------|------------|
| governance-service (3300) | Policy/rule/binding definitions, approval chains, control tests, containment, waivers | Node/Express, schema `governance` |
| ai-inference-service (3301) | Model registry, inference requests/decisions, sanctioned-provider flag | Node/Express, schema `ai_inference` |
| audit-service (3302) | Append-only compliance event log, monthly range-partitioned | Node/Express, schema `audit` |
| escalation-service (3303) | Rules engine, incident lifecycle, notification log | Node/Express, schema `escalation` |
| telemetry-service (3304) | Metrics ingestion — auto-compress 7d, auto-drop 90d | Node/Express, TimescaleDB hypertable, schema `telemetry` |
| workflow-governance-service (3305) | Multi-platform workflow import, risk scoring, PII detection, AI analysis, lineage, attack-path | Node/Express, schema `workflow_governance` |
| mcp-governance-service (3306) | MCP server/tool/resource registry, risk scoring, live Kong provisioning, credential scanning | Node/Express, schema `mcp_governance` |
| auth-service (3307) | RS256 JWT issuance, RBAC, API keys, admin/guest seeding | Node/Express, schema `auth` |
| api-docs (3399) | Unified Swagger UI aggregating every service's OpenAPI doc | Node/Express (static aggregator, no DB) |
| web SPA | Full governance CRUD UI | React 18, Vite, Tailwind v4, TanStack Query, React Router |
| /ioa CLI | Dev-lifecycle governance checks | Node.js, `packages/ioa-cli/` |
| discovery-agent | Reports local MCP client configs to mcp-governance-service | Node.js, `packages/discovery-agent/` |
| bootstrap generator | Generates all infra files from `platform.config.yaml` | Node.js + Handlebars |

## Key Decisions

- **Config-driven generation over hand-maintained infra**: a single
  `platform.config.yaml` is the only edit point for ports/replicas/routes;
  regenerating (`npm run bootstrap`) keeps 9 services' Docker/K8s/Kong/DB
  definitions from drifting apart. See `CLAUDE.md` — "Critical rule:
  config-driven generation."
- **Duplicated, not shared, auth middleware**: `require-auth.js` is
  byte-identical across services but deliberately copied rather than
  published as an npm package, for the same reasoning as
  `credential-scanner.js` — see `CLAUDE.md`, Epic 2 (AUTH-201).
- **Kong is shared infrastructure this project does not own**: the compose
  generator never emits a `kong-gateway` service; services join the external
  `kong-net` network so the already-running shared Kong container can reach
  them. Declarative sync (`kong.yaml` / `deck gateway sync`) is always scoped
  with `--select-tag ioa-governance` — an unscoped sync would delete every
  other team's Kong config on that shared instance (this happened once;
  recovered from a `deck gateway dump` backup). See `CLAUDE.md` — "Kong
  topology."
- **Fail-open on missing permissions claim**: JWTs issued before Epic 5
  (no `permissions` claim) are treated as unrestricted rather than rejected,
  since they expire within the 60-minute TTL regardless. Deliberate rollout
  tradeoff, not an oversight.
