# IOA Governance Platform — Architecture Diagram Specification

This document describes the system's components and their relationships, written
to be handed to an AI diagramming tool to generate an architecture drawing.
Use the **Nodes** and **Connections** sections as the literal diagram contents;
the prose sections give context for labeling/grouping decisions.

## System summary

IOA Governance Platform is a microservices system for governing AI/agent tooling
inside an enterprise: policy enforcement, MCP (Model Context Protocol) server
registry and risk scoring, n8n workflow governance, AI inference decisioning,
audit logging, and incident escalation. All traffic enters through a shared API
gateway (Kong); each backend service owns an isolated schema in one shared
Postgres/TimescaleDB instance. A standalone CLI (`discovery-agent`) runs outside
the cluster entirely, on developer machines or in CI/CD, and reports what MCP
servers it finds back into the platform over the same public API surface a
browser would use.

## Suggested visual grouping (swimlanes / layers, top to bottom)

1. **External clients** — Browser (SPA user), discovery-agent CLI (external), n8n Cloud (external), CI/CD or a Kubernetes CronJob
2. **Edge** — Kong API Gateway
3. **Application services** — the 8 backend services + api-docs
4. **Data layer** — Postgres/TimescaleDB (8 schemas), Redis (shared, external)
5. **External integrations** — n8n Cloud REST API, GitHub API (planned), Docker/Kubernetes APIs

## Nodes

### Client layer
- **Web SPA** — React 18 + Vite + TanStack Query. The primary human UI. Talks only to Kong, never directly to a backend service.
- **discovery-agent CLI** — standalone Node.js CLI (not a deployed service). Runs on a developer laptop, in CI, or as a Kubernetes CronJob. Scans local config files (Claude Desktop, VS Code, Cline, Cursor, Windsurf) and running Docker containers for MCP server references, then reports them to the platform through Kong.
- **n8n Cloud** — external workflow-automation SaaS. Source of workflow definitions; also calls back into the platform (webhooks) when async AI analysis jobs complete.

### Edge / Gateway
- **Kong API Gateway** — shared infrastructure not owned by this platform (also fronts unrelated teams' services). DB-backed (Postgres-persisted), not DB-less. Path-based routing with `strip_path: true`; every route below is reached at `/api/<prefix>/...`. Enforces rate limiting (100 req/min general, 10 req/min on auth endpoints).

### Application services (each is an independently deployable Node.js/Express container)
- **auth-service** (port 3307, schema `auth`) — issues/verifies sessions, users, roles/permissions, API keys. The only service every other service trusts for identity.
- **governance-service** (port 3300, schema `governance`) — policy definitions, rules, bindings, violations, approval chains, enforcement decisions, containment (kill-switch) actions.
- **mcp-governance-service** (port 3306, schema `mcp_governance`) — MCP server/tool/prompt/resource registry, risk scoring, credential-exposure scanning, discovery-import intake, Kong provisioning for approved MCP servers.
- **workflow-governance-service** (port 3305, schema `workflow_governance`) — imports and risk-scores n8n (and Make/Zapier/Camunda) workflows, resolves MCP references inside workflow nodes, lineage tracking, anomaly detection, attack-path analysis.
- **ai-inference-service** (port 3301, schema `ai_inference`) — AI model registry, inference request/decision logging.
- **audit-service** (port 3302, schema `audit`) — append-only compliance event log, monthly partitioned.
- **escalation-service** (port 3303, schema `escalation`) — escalation rules engine, incident lifecycle, notification log.
- **telemetry-service** (port 3304, schema `telemetry`) — TimescaleDB hypertable for cross-service operational metrics and MCP tool invocation telemetry.
- **api-docs** (port 3399, schema `api_docs`) — aggregated OpenAPI/Swagger documentation UI for the platform.

### Data layer
- **PostgreSQL / TimescaleDB** — one shared instance, 8 isolated schemas (one per service above, matching by name). Each service's DB client sets `search_path` to only its own schema.
- **Redis** (`redis-master`) — shared infrastructure, external to this platform (like Kong). Used by workflow-governance-service for response caching.

### External integrations
- **n8n Cloud REST API** — workflow-governance-service pulls workflow/project definitions from it and triggers AI-analysis webhooks.
- **GitHub API** — planned (EP-306-S7, not yet built) integration for discovery-agent to scan repos for MCP config/usage.
- **Docker Engine API / Kubernetes API** — discovery-agent shells out to the local `docker` CLI (Kubernetes/`kubectl` support planned) to detect MCP servers running in containers.

## Connections

Format: `Source → Target : protocol — purpose`

- `Browser → Kong : HTTPS — all SPA traffic`
- `Kong → auth-service : HTTP — /api/auth/*`
- `Kong → governance-service : HTTP — /api/governance/*`
- `Kong → mcp-governance-service : HTTP — /api/mcp-governance/*`
- `Kong → workflow-governance-service : HTTP — /api/workflow-governance/*`
- `Kong → ai-inference-service : HTTP — /api/inference/*`
- `Kong → audit-service : HTTP — /api/audit/*`
- `Kong → escalation-service : HTTP — /api/escalation/*`
- `Kong → telemetry-service : HTTP — /api/telemetry/*`
- `Kong → api-docs : HTTP — /api/docs/*`
- `discovery-agent CLI → Kong : HTTPS — POST /api/auth/api-keys/exchange (trade API key for short-lived JWT)`
- `discovery-agent CLI → Kong : HTTPS — POST /api/mcp-governance/servers/discovery-import (Bearer JWT)`
- `discovery-agent CLI → Local filesystem : reads Claude Desktop / VS Code / Cline / Cursor / Windsurf config files`
- `discovery-agent CLI → Docker Engine (local socket, via docker CLI) : inspects running containers`
- `n8n Cloud → workflow-governance-service : HTTPS webhook — async AI-analysis job completion callback (HMAC-signed)`
- `workflow-governance-service → n8n Cloud REST API : HTTPS — pull workflow/project definitions, trigger analysis`
- `workflow-governance-service → mcp-governance-service : HTTP, INTERNAL_SERVICE_KEY — resolve/report MCP server references found in workflows`
- `workflow-governance-service → governance-service : HTTP, INTERNAL_SERVICE_KEY — policy evaluation, violation posture`
- `workflow-governance-service → telemetry-service : HTTP, INTERNAL_SERVICE_KEY — execution telemetry`
- `mcp-governance-service → governance-service : HTTP, INTERNAL_SERVICE_KEY — policy evaluation, approval chains`
- `mcp-governance-service → escalation-service : HTTP, INTERNAL_SERVICE_KEY — create incidents (e.g. new discoveries, containment actions)`
- `mcp-governance-service → telemetry-service : HTTP, INTERNAL_SERVICE_KEY — MCP tool invocation telemetry`
- `mcp-governance-service → Kong Admin API : HTTPS — dynamic route/plugin provisioning per approved MCP server`
- `governance-service → escalation-service : HTTP, INTERNAL_SERVICE_KEY — containment-triggered incidents`
- `auth-service → audit-service : HTTP, INTERNAL_SERVICE_KEY — auth event logging (login/logout/failures/API key events)`
- `All 8 services → PostgreSQL/TimescaleDB : each connects only to its own schema`
- `workflow-governance-service → Redis : caching`
- `All 8 services → Kong Admin API : declarative route sync (deploy-time, via shared kong.yaml)`

## Authentication model (useful as a callout box or legend, not necessarily drawn as nodes)

Three distinct credential types flow through the same Kong edge:
1. **Browser session** — httpOnly session cookie + CSRF double-submit cookie, issued by auth-service on login.
2. **Service-to-service** — shared `INTERNAL_SERVICE_KEY` header, used for every service-to-service call listed above.
3. **API key (external clients)** — a long-lived scoped key (e.g. held by discovery-agent) is exchanged at auth-service for a short-lived (15 min) JWT, then used via `Authorization: Bearer` exactly like a browser session would be, on any service.

## Deployment topology notes

- Local development: Docker Compose (this project's own `docker-compose.yml` starts the 8 services + Postgres; Kong and Redis are pre-existing shared containers this project joins via an external Docker network, not started by this compose file).
- Production: Kubernetes manifests (Deployments + Services per backend service, generated from a single `platform.config.yaml`).
- Kong and Redis are multi-tenant shared infrastructure — several unrelated teams' services run on the same Kong instance.
