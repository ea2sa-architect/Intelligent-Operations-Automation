# PRD: ioa-governance-platform

---

## Problem

AI-driven automation — n8n/Make/Zapier/Camunda/Power-Automate workflows, MCP
servers, and LLM inference calls — proliferates faster than manual governance
review can track it. Without a system of record, risky automations (PII
exposure, unsanctioned model providers, unreviewed MCP servers with excessive
trust) ship into production ungoverned, and there's no audit trail sufficient
to prove otherwise after the fact.

## Goals

Every workflow, MCP server, and inference call is discoverable, risk-scored
against explicit policy, and blocked or escalated when it violates a binding
rule — with a compliance-grade audit trail, and a developer-facing CLI/skill
that brings the check into the dev loop instead of bolting it on afterward.

---

## Requirements

### RF-01: Policy Definition & Enforcement

`governance-service` must let admins define policies, rules, and bindings
with full version history, and evaluate those rules against real inputs
(`rule-evaluator.js`), including multi-step approval chains, control tests,
containment actions, and time-boxed waivers.

### RF-02: AI Inference Governance

`ai-inference-service` must maintain a model registry and track every
inference request/decision, flagging calls to non-sanctioned providers.

### RF-03: Compliance Audit Trail

`audit-service` must maintain an append-only, monthly range-partitioned
event log for every governance-relevant action across the platform.

### RF-04: Alert Escalation

`escalation-service` must run a rules engine over incidents with full
lifecycle tracking and a notification log.

### RF-05: Telemetry & Observability

`telemetry-service` must ingest metrics from every service into a
TimescaleDB hypertable, auto-compressing after 7 days and dropping after 90.

### RF-06: Workflow Risk Governance

`workflow-governance-service` must import workflows from n8n, Make, Zapier,
Camunda, and Power Automate; score risk; detect PII exposure; build
data-lineage and attack-path/blast-radius views; and support async
AI-assisted analysis via an n8n-hosted agent.

### RF-07: MCP Server Governance

`mcp-governance-service` must register MCP servers/tools/resources,
risk-score them, scan for exposed credentials, and — on human approval —
auto-provision live Kong enforcement (service + route + plugin) for that
server.

### RF-08: Identity & Access

`auth-service` must issue RS256 JWTs, enforce a coarse read/write RBAC model
via a shared `require-auth.js` middleware applied globally in every other
service, and support scoped API-key issuance.

### RF-09: Unified Governance UI

The `web/` React SPA must give full CRUD access to policies, workflows, the
MCP registry, and the tag registry, with contextual InfoTips guiding
non-expert users through governance concepts.

### RF-10: Developer-Lifecycle Governance

The `/ioa` CLI (`packages/ioa-cli/`) must let developers build, check,
assess, threat-model, QA, and certify workflows against governance policy
directly from their local dev workflow — always through the IOA API, never
bypassing it as the system of record.
