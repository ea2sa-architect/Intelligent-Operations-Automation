# IOA Governance Platform

A microservices platform for AI governance — policy enforcement, inference auditing,
alert escalation, and telemetry collection. All infrastructure is generated from a
single configuration file.

---

## Services

| Service | Port | Purpose |
|---|---|---|
| governance-service | 3300 | Policy definitions, rules, and entity bindings |
| ai-inference-service | 3301 | AI model registry, inference requests, and decisions |
| audit-service | 3302 | Append-only compliance event log |
| escalation-service | 3303 | Alert escalation rules, incidents, and notification log |
| telemetry-service | 3304 | Time-series metrics (TimescaleDB) |
| workflow-governance-service | 3305 | n8n/Make/Zapier/Camunda/Power-Automate workflow import, risk scoring, PII detection, AI analysis |
| mcp-governance-service | 3306 | MCP server/tool/resource registry, risk scoring, live Kong provisioning on approval |
| auth-service | 3307 | Identity, RS256 JWT issuance, RBAC, API keys |
| api-docs | 3399 | Unified Swagger UI hub aggregating OpenAPI docs from every service (no DB) |

Traffic enters through **Kong API Gateway** on port `8000`. Each service is reachable
at `/api/<service-name>` via the proxy, or directly on its port during local development.

---

## Prerequisites

- [Node.js 20+](https://nodejs.org/)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)

---

## Quick start

```bash
# Install dependencies
npm install

# Generate all infrastructure files
npm run bootstrap

# Start the database
docker compose up db

# Apply database migrations
npm run migrate

# Start the full platform
docker compose up --build

# Sync Kong routes for the 9 platform services (requires the shared Kong
# instance to already be running — see kong-api-gateway/docker-compose.yml;
# this project's own docker-compose.yml deliberately does not start Kong)
npm run kong:sync
```

| Endpoint | URL |
|---|---|
| Kong proxy | http://localhost:8000 |
| Kong admin API | http://localhost:8001 |
| governance-service (direct) | http://localhost:3300 |
| ai-inference-service (direct) | http://localhost:3301 |
| audit-service (direct) | http://localhost:3302 |
| escalation-service (direct) | http://localhost:3303 |
| telemetry-service (direct) | http://localhost:3304 |
| workflow-governance-service (direct) | http://localhost:3305 |
| mcp-governance-service (direct) | http://localhost:3306 |
| auth-service (direct) | http://localhost:3307 |
| api-docs (direct) | http://localhost:3399 |

---

## Project structure

```
bootstrap/                    Infrastructure code generator
  platform.config.yaml        ← edit this to change ports, routes, or add services
  bootstrap-platform.js       CLI entry point
  generators/                 Generator modules (service, k8s, compose, kong)
  templates/                  Handlebars templates for service files

db/
  migrate.js                  Idempotent migration runner
  migrations/                 SQL migration files, one directory per schema

services/                     Generated service stubs (do not edit by hand)
k8s/                          Generated Kubernetes manifests
kong/                         Generated Kong declarative config
```

> **Generated files** (`services/*/`, `k8s/`, `docker-compose.yml`, `kong/kong.yaml`)
> are created by `npm run bootstrap`. Do not edit them directly — changes will be
> overwritten. Make changes in `bootstrap/platform.config.yaml` or the templates instead.

---

## Bootstrap CLI

```bash
npm run bootstrap                        # regenerate everything
npm run migrate                          # apply DB migrations

# Selective generation
node bootstrap/bootstrap-platform.js bootstrap --services-only
node bootstrap/bootstrap-platform.js bootstrap --k8s-only
node bootstrap/bootstrap-platform.js bootstrap --compose-only
node bootstrap/bootstrap-platform.js bootstrap --kong-only

# Migrate against a specific database
node bootstrap/bootstrap-platform.js migrate --url postgresql://user:pass@host:5432/db
```

---

## Adding a new service

1. Add an entry to `bootstrap/platform.config.yaml`:

```yaml
services:
  - name: my-new-service
    description: What it does
    schema: my_schema
    port: 3305
    replicas: 1
    routes:
      - path: /api/my-service
        stripPath: true
        methods: [GET, POST]
```

2. Create `db/migrations/my_schema/001_initial.sql` with your schema DDL.
3. Run `npm run bootstrap` then `npm run migrate`.

---

## Database

All services share a single **TimescaleDB** (PostgreSQL 16) instance. Each service is
isolated by its own schema and connects via a `pg` Pool with `SET search_path` applied
on every connection.

| Schema | Notable design |
|---|---|
| `governance` | Full policy version history |
| `ai_inference` | Input hash for deduplication; confidence score 0–1 |
| `audit` | Range-partitioned by month; add a new partition each month |
| `escalation` | Incident status machine: `open → acknowledged → resolved → closed` |
| `telemetry` | TimescaleDB hypertable; chunks compress after 7 days, drop after 90 |
| `workflow_governance` | Workflows, nodes, PII exposure, async AI-analysis job tracking, tag registry |
| `mcp_governance` | MCP server/tool/resource registry, risk scoring |
| `auth` | Users, roles/permissions, API keys — the only schema no other service reads directly (JWT claims carry what's needed) |

Migration state is tracked in `public.migrations`. Migrations are idempotent and safe
to re-run.

---

## Kubernetes

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/
```

Each service gets a `Deployment` and `ClusterIP` `Service` manifest under `k8s/<service-name>/`.
The `ai-inference-service` has resource limits set (`512Mi` / `500m`) due to model workload.

---

## Web SPA

The platform ships a React single-page application under `web/`. It is the primary
operator interface for every service — policy management, AI model registry,
inference monitoring, audit log review, escalation triage, and telemetry charts.

### Architecture

```
Browser (localhost:5173)
       │
       │  /api/*   (all API calls prefixed with /api)
       ▼
Vite dev proxy  ──►  Kong :8000  ──►  governance-service           :3300
                                  ──►  ai-inference-service         :3301
                                  ──►  audit-service                :3302
                                  ──►  escalation-service           :3303
                                  ──►  telemetry-service             :3304
                                  ──►  workflow-governance-service   :3305
                                  ──►  mcp-governance-service        :3306
                                  ──►  auth-service                  :3307
                                  ──►  api-docs                      :3399
```

Kong strips the `/api/<service-slug>` prefix before forwarding. The browser never
talks directly to a service — every request goes through the gateway regardless of
environment.

### Pages and the services they use

| Page | Service | Key operations |
|---|---|---|
| **Governance** | `governance-service` | Create/edit/archive policies; manage rules (condition JSON + priority) and entity bindings; status transitions `draft → active → inactive → archived` |
| **AI Inference** | `ai-inference-service` | Register models; activate / deprecate; submit inference requests; record decisions with confidence scores |
| **Audit** | `audit-service` | Browse the append-only compliance event log; filter by event type, actor, or resource |
| **Escalation** | `escalation-service` | Define escalation rules (condition JSON + channels); view incidents; drive the `open → acknowledged → resolved → closed` lifecycle |
| **Telemetry** | `telemetry-service` | Summary cards (avg/min/max per metric); Recharts line chart pivoted by `service_name`; raw metric table |
| **Workflow Governance** | `workflow-governance-service` | Import n8n/Make/Zapier/Camunda/Power-Automate workflows; risk scoring, PII exposure, AI-assisted analysis, tags |

Plus an **Administration** section (MCP registry, approval chains, control tests,
prompt registry, user management, waivers, API docs, tag admin — auth-service and
mcp-governance-service backed) and standalone pages (Anomaly Detection, Assurance,
Lineage). Full per-file inventory: `governance/architecture/modules/web.md`.

### API contract layer — `web/src/lib/api.js`

All HTTP calls are centralised in a single module. Each domain object maps 1-to-1 with
a service and exposes named functions that the React pages import:

```
api.js
 ├── governance   →  /api/governance/policies  (CRUD + rules + bindings)
 ├── inference    →  /api/inference/models      (registry + status)
 │                   /api/inference/inference   (requests + decisions)
 ├── audit        →  /api/audit/events
 ├── escalation   →  /api/escalation/rules
 │                   /api/escalation/incidents  (+ status transitions)
 └── telemetry    →  /api/telemetry/metrics     (ingest + query + summary)
```

### Running the SPA in development

```bash
cd web
npm install
npm run dev          # starts Vite at http://localhost:5173
```

The Vite proxy in `web/vite.config.js` forwards `/api/*` to `http://phoenix:8000`
(the Kong gateway on the shared dev server). Change the `target` if your gateway
runs elsewhere.

### Building for production

```bash
cd web
npm run build        # outputs to web/dist/
```

Serve `web/dist/` from any static host or add a Kong route that points to a static
file server sitting in front of the built assets.

---

## Tech stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20, ESM |
| Web framework | Express 4 |
| Database | TimescaleDB / PostgreSQL 16 |
| DB client | node-postgres (`pg`) |
| API Gateway | Kong 3.7 (DB-backed, shared instance — see CLAUDE.md's "Kong topology" section) |
| Containers | Docker Compose (local), Kubernetes (production) |
| Templating | Handlebars + js-yaml |
| SPA | React 18, Vite, TanStack Query, React Router v6, Tailwind v4, Recharts |
