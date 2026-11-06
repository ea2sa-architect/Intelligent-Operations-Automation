---
type: architecture_context
project: "ioa-governance-platform"
status: active
tech_stack:
  services: "Node.js 20, Express 4, ESM"
  database: "TimescaleDB (PostgreSQL 16 + extension), one instance, per-service schema"
  gateway: "Kong 3.7 (DB-backed, shared instance — not owned by this project)"
  spa: "React 18, Vite, Tailwind v4, TanStack Query, React Router v6, Recharts"
  containers: "Docker Compose (local), Kubernetes (prod)"
external_dependencies: ["n8n Cloud", "Kong Gateway (shared)", "Make", "Zapier", "Camunda", "Power Automate"]
users: ["Governance admins (web SPA)", "Platform developers (/ioa CLI)", "n8n Cloud AI agent (webhook callback)"]
governed_by: ["governance-service"]
---

# System Context: ioa-governance-platform

> C4 Level 1 — System Context diagram and description

## Overview

IOA Governance Platform governs AI-driven automation across an
organization: n8n/Make/Zapier/Camunda/Power-Automate workflows, MCP
servers, and LLM inference calls. Governance admins use the web SPA to
define policy and review risk; developers use the `/ioa` CLI to check
their own workflows against policy before and during development; an
n8n-hosted AI agent performs async governance analysis and reports back
via webhook callback. All external access — human or automated — passes
through the shared Kong gateway, which is the platform's single ingress
boundary.

## Context Diagram

```
┌────────────────┐     ┌──────────────┐     ┌─────────────────────┐
│ Governance      │────►│              │────►│ n8n Cloud            │
│ Admin (web SPA) │     │              │◄────│ (workflows + AI      │
└────────────────┘     │  Kong Gateway │     │  analysis agent)     │
┌────────────────┐     │  (shared,     │     └─────────────────────┘
│ Developer        │────►│  not owned    │     ┌─────────────────────┐
│ (/ioa CLI)       │     │  by this      │────►│ Make / Zapier /      │
└────────────────┘     │  project)     │     │ Camunda / Power       │
                        │               │     │ Automate              │
                        └──────┬────────┘     └─────────────────────┘
                               │
                               ▼
                  ┌─────────────────────────┐
                  │ IOA Governance Platform  │
                  │ (9 services, 1 Postgres/ │
                  │ TimescaleDB instance)    │
                  └─────────────────────────┘
```

## External Interfaces

| System | Direction | Protocol | Description |
|--------|-----------|----------|-------------|
| n8n Cloud | Outbound (trigger) | HTTPS webhook | `workflow-governance-service` fires `N8N_ANALYSIS_WEBHOOK_URL` to start async AI governance analysis |
| n8n Cloud | Inbound (callback) | HTTPS POST | AI agent calls back `POST /workflows/analyze/callback/:job_id` with results (currently unauthenticated — see backlog E8) |
| n8n Cloud | Outbound | REST | `n8n-client.js` reads/imports workflows and projects via n8n Cloud's REST API |
| Make / Zapier / Camunda / Power Automate | Outbound | REST/vendor API | Per-platform adapters (`src/lib/adapters/*.js`) import and normalize workflows |
| Kong Gateway (shared) | Bidirectional | HTTP + deck (declarative) | All external traffic routes through Kong at `/api/*`; `kong.yaml` + `npm run kong:sync` provisions this platform's 9 fixed services (scoped with `--select-tag ioa-governance`); `mcp-governance-service` additionally provisions live per-MCP-server routes via the Kong Admin API |
| Web SPA (browser) | Inbound | HTTPS via Kong | Full governance CRUD UI |
| `/ioa` CLI (developer) | Inbound | HTTPS via Kong | Dev-lifecycle governance checks (build-policy, policy-check, assess, threat-model, qa, verify-release) |
