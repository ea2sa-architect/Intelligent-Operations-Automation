# IOA Governance Platform — UI Inventory

Every top-level navigation destination, its tabs, and what's actually on screen — pulled from the live sidebar (`Layout.jsx`), the route table (`App.jsx`), and a logged-in screenshot pass against the running SPA. Six groups plus Administration's own 8-tab sub-nav.

Captured against an admin session, 1440×900 viewport, 23 screens.

## Navigation map

| Nav group | Route | Screen | Tabs | What's on screen |
|---|---|---|---|---|
| **Platform**<br><sub>no pillar — sits above the five groups</sub> | `/` | Dashboard | — | Automation Trust Index + Enforcement Activity hero cards, 4 stat tiles (Policies/Active/Incidents/Models), Open Incidents + Recent Policies lists |
| **Governance**<br><sub>policy definitions, violations, enforcement, MCP registry</sub> | `/governance` | Policies | — | Policy table (Name/Status/Version/Violations/Created); detail modal holds Rules + Bindings editors and the Observe/Warn/Enforce mode toggle |
|  | `/violations` | Violations | — | Status + Severity filters; table expands in-place to a waiver panel and status history timeline per row |
|  | `/enforcement` | Enforcement | — | 4-card decision-outcome strip, By-Policy breakdown table, raw enforcement-events table with correlation IDs |
|  | `/mcp-registry` | MCP Registry | Registry, Discovered | Registry tab: server table + detail modal (tools, credential exposure, assurance evidence, unified history) |
|  | `/mcp-registry` | MCP Registry | Registry, Discovered | Discovered tab: scan queue from the discovery-agent CLI, Promote / Dismiss actions, diff-since-last-scan |
| **Risk**<br><sub>n8n workflow risk scoring</sub> | `/workflows` | Workflows | Summary, Workflows, Node Types, By Domain | Summary tab: stat cards, risk distribution bar, PII-exposure and hardcoded-secrets tables, top-risk-workflows list |
| **Assurance**<br><sub>recoverability evidence, data lineage, anomaly detection</sub> | `/assurance` | Assurance | — | Auto-collected platform health tiles (API Gateway / DB / n8n / Containers) + per-workflow evidence table |
|  | `/lineage` | Data Lineage | — | Summary strip (chains/violations/external/cross-border), chain table expanding to an SVG data-flow DAG |
|  | `/anomaly` | Anomaly Detection | Alerts, Baselines, Attack Paths | Alerts tab: 5-card severity strip, expandable alert rows with deviation score and correlation ID |
| **Runtime Intelligence**<br><sub>telemetry, inference, audit, escalation</sub> | `/telemetry` | Telemetry | Summary, Chart, AI cost & tokens, Raw | Summary tab: per-service/metric cards (avg/min/max, sample count) |
|  | `/inference` | AI Inference | Models, Requests, Decisions | Models tab: registry table (Name/Version/Status/Endpoint/Sanctioned) — this is what EP-201-F5 now enforces against |
|  | `/audit` | Audit Log | — | 4-column filter grid (Actor/Resource/Event/Outcome), append-only events table, raw event-detail modal |
|  | `/escalation` | Escalation | Incidents, Rules | Incidents tab: table + detail modal with containment actions (Suspend/Quarantine/Restore/Rollback) and notification log |
| **Business Value**<br><sub>ROI modeling</sub> | `/roi` | ROI Intelligence | — | Live/Manual data toggle, 6 assumption sliders, value/ROI/payback stat cards, pillar-by-pillar before/after breakdown |
| **Administration**<br><sub>8-tab horizontal sub-nav under one section</sub> | `/admin/tags` | Tags | — | Tag registry table with inline add/edit rows |
|  | `/admin/waivers` | Waivers | — | Waiver table with expiry-urgency labels and Approve/Deny actions |
|  | `/admin/approval-chains` | Approval Chains | — | Chain-template table + pending-approvals table with an inline decision panel |
|  | `/admin/integrations` | Integrations | — | Platform-picker (n8n/Make/Zapier/Power Automate) + connection cards with test/expand actions |
|  | `/admin/users` | Users | — | User table with inline Role Editor and Password Reset Editor rows |
|  | `/admin/control-tests` | Control Tests | — | 3-card pass/fail/pending strip, test table expanding to per-run history |
|  | `/admin/prompt-registry` | Prompt Registry | — | Prompt table expanding to content, approved models, permitted data classes, and version history |
|  | `/admin/api-docs` | API Docs | — | Embedded live OpenAPI UI (iframe) |

## Screens

### Platform
*no pillar — sits above the five groups*

#### `/` — Dashboard
Automation Trust Index + Enforcement Activity hero cards, 4 stat tiles (Policies/Active/Incidents/Models), Open Incidents + Recent Policies lists

![Dashboard](screenshots/01-dashboard.png)

### Governance
*policy definitions, violations, enforcement, MCP registry*

#### `/governance` — Policies
Policy table (Name/Status/Version/Violations/Created); detail modal holds Rules + Bindings editors and the Observe/Warn/Enforce mode toggle

![Policies](screenshots/02-governance-policies.png)

#### `/violations` — Violations
Status + Severity filters; table expands in-place to a waiver panel and status history timeline per row

![Violations](screenshots/03-violations.png)

#### `/enforcement` — Enforcement
4-card decision-outcome strip, By-Policy breakdown table, raw enforcement-events table with correlation IDs

![Enforcement](screenshots/04-enforcement.png)

#### `/mcp-registry` — MCP Registry — tabs: Registry, Discovered
Registry tab: server table + detail modal (tools, credential exposure, assurance evidence, unified history)

![MCP Registry](screenshots/05-mcp-registry.png)

#### `/mcp-registry` — MCP Registry — tabs: Registry, Discovered
Discovered tab: scan queue from the discovery-agent CLI, Promote / Dismiss actions, diff-since-last-scan

![MCP Registry](screenshots/06-mcp-registry-discovered.png)

### Risk
*n8n workflow risk scoring*

#### `/workflows` — Workflows — tabs: Summary, Workflows, Node Types, By Domain
Summary tab: stat cards, risk distribution bar, PII-exposure and hardcoded-secrets tables, top-risk-workflows list

![Workflows](screenshots/07-workflows-summary.png)

### Assurance
*recoverability evidence, data lineage, anomaly detection*

#### `/assurance` — Assurance
Auto-collected platform health tiles (API Gateway / DB / n8n / Containers) + per-workflow evidence table

![Assurance](screenshots/08-assurance.png)

#### `/lineage` — Data Lineage
Summary strip (chains/violations/external/cross-border), chain table expanding to an SVG data-flow DAG

![Data Lineage](screenshots/09-data-lineage.png)

#### `/anomaly` — Anomaly Detection — tabs: Alerts, Baselines, Attack Paths
Alerts tab: 5-card severity strip, expandable alert rows with deviation score and correlation ID

![Anomaly Detection](screenshots/10-anomaly-detection.png)

### Runtime Intelligence
*telemetry, inference, audit, escalation*

#### `/telemetry` — Telemetry — tabs: Summary, Chart, AI cost & tokens, Raw
Summary tab: per-service/metric cards (avg/min/max, sample count)

![Telemetry](screenshots/11-telemetry-summary.png)

#### `/inference` — AI Inference — tabs: Models, Requests, Decisions
Models tab: registry table (Name/Version/Status/Endpoint/Sanctioned) — this is what EP-201-F5 now enforces against

![AI Inference](screenshots/12-ai-inference-models.png)

#### `/audit` — Audit Log
4-column filter grid (Actor/Resource/Event/Outcome), append-only events table, raw event-detail modal

![Audit Log](screenshots/13-audit.png)

#### `/escalation` — Escalation — tabs: Incidents, Rules
Incidents tab: table + detail modal with containment actions (Suspend/Quarantine/Restore/Rollback) and notification log

![Escalation](screenshots/14-escalation-incidents.png)

### Business Value
*ROI modeling*

#### `/roi` — ROI Intelligence
Live/Manual data toggle, 6 assumption sliders, value/ROI/payback stat cards, pillar-by-pillar before/after breakdown

![ROI Intelligence](screenshots/15-roi-intelligence.png)

### Administration
*8-tab horizontal sub-nav under one section*

#### `/admin/tags` — Tags
Tag registry table with inline add/edit rows

![Tags](screenshots/16-admin-tags.png)

#### `/admin/waivers` — Waivers
Waiver table with expiry-urgency labels and Approve/Deny actions

![Waivers](screenshots/17-admin-waivers.png)

#### `/admin/approval-chains` — Approval Chains
Chain-template table + pending-approvals table with an inline decision panel

![Approval Chains](screenshots/18-admin-approval-chains.png)

#### `/admin/integrations` — Integrations
Platform-picker (n8n/Make/Zapier/Power Automate) + connection cards with test/expand actions

![Integrations](screenshots/19-admin-integrations.png)

#### `/admin/users` — Users
User table with inline Role Editor and Password Reset Editor rows

![Users](screenshots/20-admin-users.png)

#### `/admin/control-tests` — Control Tests
3-card pass/fail/pending strip, test table expanding to per-run history

![Control Tests](screenshots/21-admin-control-tests.png)

#### `/admin/prompt-registry` — Prompt Registry
Prompt table expanding to content, approved models, permitted data classes, and version history

![Prompt Registry](screenshots/22-admin-prompt-registry.png)

#### `/admin/api-docs` — API Docs
Embedded live OpenAPI UI (iframe)

![API Docs](screenshots/23-admin-api-docs.png)
