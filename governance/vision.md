# Solution Vision: ioa-governance-platform

## Identity

### Description

IOA Governance Platform is a microservices platform for AI governance: policy
enforcement, AI inference decisions, compliance audit logging, alert
escalation, telemetry, MCP server registry governance, and multi-platform
workflow risk governance (n8n, Make, Zapier, Camunda, Power Automate). All
backend infrastructure — Docker, Kubernetes, Kong routes, and database
schemas — is code-generated from a single `bootstrap/platform.config.yaml`,
and a React SPA gives non-expert users full CRUD control over policies,
workflows, and the MCP/tag registries without bypassing IOA as the system of
record.

## Outcomes

| **Outcome** | **Description** |
|-------------|-----------------|
| **Core Value** | Every AI-driven automation — n8n/Make/Zapier/Camunda/Power-Automate workflows, MCP servers, and AI inference calls — is registered, risk-scored, and governed against explicit policy before and during production use, instead of shipping ungoverned. |
| **Reproducibility** | Config-driven infrastructure generation (`bootstrap/platform.config.yaml` + `npm run bootstrap`) keeps all 9 services' Docker, Kubernetes, Kong routing, and DB-schema definitions consistent and reproducible; identity/access is enforced uniformly via a byte-identical `require-auth.js` applied globally in every protected service. |
| **Auditability** | Every governance-relevant action lands in an append-only, monthly-partitioned audit log (`audit-service`), sufficient for compliance review without relying on service-specific logging. |
