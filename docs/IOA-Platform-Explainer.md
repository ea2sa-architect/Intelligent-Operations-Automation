# IOA: Governance for the Automation You Didn't Know You Had

*Background material for a blog post — facts, architecture, real examples, and honest gaps. Written from direct, hands-on work on the platform: every number and code reference here is real, not aspirational.*

---

## 1. The problem it starts from

An audit of an organization's automations (n8n workflows, Zapier zaps, Power Automate flows, Camunda processes) turns up a familiar list: exposed API keys sitting in plaintext inside workflow parameters, no monitoring on what these things actually do at runtime, and no evidence anyone could restore them if the underlying tool disappeared tomorrow.

Those are *findings*. They are not yet *decision-quality information*. A finding tells you something is wrong; it doesn't tell you how wrong relative to everything else wrong, who's accountable for fixing it, whether it's already being managed, or whether the business can tolerate the risk it represents. That gap — between "here's a list of problems" and "here's what we should actually do about them, in what order, and how we'd defend that decision to an auditor" — is what IOA (the "IOA Governance Platform") is built to close.

The premise: apply a *repeatable* risk model to every automation, not a one-off human read of "OpenAI Chat Model uses openai (base risk 85)" that varies by whoever runs the review. Do it the same way every time, and produce numbers that are consistent enough to trend over time, group by business domain, and roll up into a single executive-facing metric.

## 2. What it actually is

IOA is a microservices platform, not a single app. Six backend services, each owning its own PostgreSQL schema in a shared TimescaleDB instance, sit behind a Kong API gateway:

| Service | Port | Owns |
|---|---|---|
| `governance-service` | 3300 | Policies, rule evaluation, violations |
| `ai-inference-service` | 3301 | AI model registry, inference requests/decisions |
| `audit-service` | 3302 | Append-only compliance event log (partitioned by month) |
| `escalation-service` | 3303 | Alert rules, incident lifecycle |
| `telemetry-service` | 3304 | Time-series metrics (TimescaleDB hypertables) |
| `workflow-governance-service` | 3305 | Workflow discovery, risk scoring, PII/secret detection, tags |

All the infrastructure — Dockerfiles, docker-compose, Kubernetes manifests, Kong's declarative routing — is *generated* from one YAML config (`bootstrap/platform.config.yaml`) via a small CLI, so adding a new service is a config edit plus a migration, not hand-wiring six files. That's a deliberate choice: the platform practices what it preaches about repeatability.

On top sits a React SPA (Vite, TanStack Query, Tailwind) that's the only thing a human actually looks at. Everything below is invisible until it shows up as a number on a screen — which is really the whole design philosophy in miniature.

### The multi-platform reality

Automation sprawl doesn't respect vendor lines. IOA discovers and normalizes workflows from **n8n, Zapier, Make.com, Power Automate, and Camunda** through a common adapter interface (`testConnection`, `listWorkflows`, `getWorkflow`, `normalizeNodes`, `detectFlowLevelRisks`). Whatever platform a workflow lives on, it gets flattened into the same internal shape — nodes classified into governance categories (`ai_inference`, `http`, `database`, `webhook`, `credential`, and so on), a dependency graph, extracted credentials, detected PII, detected secrets — before a single scoring function ever runs. That normalization step is what makes "one risk model across five platforms" possible instead of five separate ad-hoc reviews.

## 3. The engine: converting observations into a score

Every workflow gets scored across **16 weighted dimensions**, each an independent function that returns a `{ score, factors }` pair — a number and the plain-English reasons behind it:

`ai_provider_risk`, `pii_exposure`, `governance_tags`, `governance_posture`, `approval_nodes`, `credential_scope`, `retry_policy`, `external_integrations`, `autonomous_execution`, `data_retention`, `error_handling`, `api_exposure`, `model_injection_risk`, `operational_visibility`, `ownership_gap`, `recoverability`.

The weights are tuned by hand and sum to exactly 1.0 (a detail that matters more than it sounds — an earlier version of the model let its weights drift to 1.10 without anyone noticing, which meant "critical" workflows could silently score higher than the scale intended). A weighted sum produces `risk_score`, bucketed into `LOW / MEDIUM / HIGH / CRITICAL`.

A real example, pulled directly from scoring a live n8n workflow ("Automated Gmail classification & response system with GPT and WhatsApp alerts"):

```
ai_provider_risk:  95   — "OpenAI Chat Model uses openai (base risk 85)", "No rate limiting on AI calls"
pii_exposure:      47   — unmasked email/phone across four downstream nodes
credential_scope:  36   — 3 credentials: openAiApi, whatsAppApi, gmailOAuth2
approval_nodes:    80   — "No human approval nodes — fully automated"
ownership_gap:     16   — "No technical owner assigned", "No business owner assigned"
governance_posture: 5   — "No policies evaluated against this workflow" (not "clean" — unassessed)
→ overall risk_score: 41.31 (MEDIUM)
```

Two things about this that matter for a blog angle:

- **The reasons are the point, not the number.** A "41.31 MEDIUM" without "unmasked email/phone across four nodes" is just a badge. The `factors` array is what turns a score into something a workflow owner can actually act on.
- **"Unassessed" is not "clean."** `governance_posture` scoring 5 out of 100 for "no policies evaluated" is a deliberate design choice — the model refuses to reward the absence of a check with the same score as passing one.

### Hardcoded secrets vs. credential references — a distinction worth its own paragraph

Early on, "credential exposure" was scored by counting how many formal n8n credentials a workflow used. That's a real signal, but it misses the actual failure mode: someone pastes an API key directly into an HTTP node's header parameter instead of using the credential store. IOA now pattern-matches for that literal shape — OpenAI keys, Anthropic keys, AWS access keys, GitHub tokens, Slack tokens, Bearer headers — independent of whether a formal credential is attached at all.

The part worth highlighting in a security-audience blog: the raw match **never reaches storage or logs**. Redaction happens at the point of detection, before the value is ever written to the parameters JSON that gets persisted — `sk-ant-...` becomes `sk-a****7f31` plus a SHA-256 fingerprint, and that's the only form that exists anywhere downstream. You can prove a secret was found and where, without the finding itself becoming a second exposure.

## 4. Two audiences, two numbers, on purpose

This is probably the single most blog-worthy design decision in the platform: **`risk_score` and the Automation Trust Index (ATI) are deliberately two different numbers, computed by two different, independently-owned functions.**

`risk_score` is an engineering metric. It answers "what's technically wrong with this specific automation," and it's meant to be read by the person who can go fix the workflow.

ATI answers a different question: "should the organization trust this automation, and by extension, this program of automations, at all?" It's a weighted blend — risk (30%), governance posture (25%), assurance completeness (25%), operational visibility (20%) — and critically, it does *not* just invert `risk_score`. A workflow that scores low risk because nothing has ever been checked reads differently than one that scores low risk because it's been verified, governed, and has a tested restore path. ATI encodes that distinction directly: signals that haven't been wired up yet default to a neutral, explicitly-flagged `provisional` value rather than silently reading as "fine."

There's also a criticality-aware ceiling: a workflow tagged `mission_critical` can't earn a high ATI on unverified governance or assurance alone, even if its raw risk score looks fine. "Looks fine because nobody's looked" isn't good enough for the automations that matter most.

ATI rolls up two ways: per-workflow (an executive can ask "is *this* automation trustworthy") and platform-wide / by-business-domain (an executive can ask "is *finance's* automation trustworthy," or "is the whole program improving quarter over quarter").

## 5. Five pillars — the organizing shape

The platform's navigation and its data model are organized around five pillars, each answering a different question:

| Pillar | Question it answers | What lives there |
|---|---|---|
| **Governance** | What rules exist, and are they being followed? | Policies, rules, bindings; the violations engine (`open → acknowledged → resolved`) |
| **Risk** | What's technically wrong, per automation? | The 16-dimension scoring engine, PII/secret drilldowns, node-type aggregates, risk trends over time |
| **Assurance** | Could we recover if this broke? | Manual attestation evidence — workflow export verified, backup verified, restore test *actually* passed, runbook exists |
| **Runtime Intelligence** | What is actually happening when it runs? | Telemetry, AI inference cost/latency, the audit log, escalation/incidents |
| **Business Value** | Is this worth it, and to whom? | ROI modeling, ownership, business-domain classification, criticality |

The last pillar is worth a note of intellectual honesty for a blog post: business classification (which domain a workflow belongs to, how critical it is, whether it touches customer data) is deliberately **not** wired into the risk score itself. It's classification and reporting only. The temptation to let "this is important" quietly inflate a technical risk number was real, and the platform resists it — a workflow's technical risk doesn't change because finance cares about it more than marketing does. What changes is how the *organization* should prioritize fixing it, which is a business decision layered on top of, not baked into, the engineering measurement.

## 6. Assurance: recoverability as evidence, not assumption

"We have backups" and "we have tested that we can restore from those backups" are not the same claim, and the platform's scoring reflects that directly: verified backup existence is worth less credit than a verified restore test. Evidence is recorded through explicit attestation — `workflow_export_verified`, `database_backup_verified`, `restore_test_passed`, `runbook_available`, each with a `verified_by` and an optional expiry — and expired evidence stops counting automatically. A backup someone verified eighteen months ago and never touched again reads, correctly, as no better than no evidence at all.

This is v1 — manual attestation, not an automated integration with a real backup system. That's a real limitation, worth naming directly: the platform can track *that* recoverability was verified, not yet verify it itself.

## 7. Operational visibility: preferring what actually happened

Most of the risk model works from static analysis of a workflow's definition — the shape of its nodes, what it's connected to, what credentials it references. `operational_visibility` is the one dimension built to prefer *observed* behavior over declared configuration: real execution telemetry (last success, last failure, 7-day failure rate) when it exists, falling back to a weaker static proxy (does this workflow even have a notification node to leave a trail?) when it doesn't. As execution telemetry gets wired up workflow by workflow, the model automatically starts trusting the better signal — no code changes required, just better data arriving.

## 8. What's honestly not there yet

A blog post about a governance platform is more credible if it says what the platform doesn't do, so:

- **Recoverability is attested, not automated.** No live integration with an actual backup/restore system yet.
- **Governance posture and the risk score are computed separately and combined carefully** — but the violations engine and the workflow-level technical scoring still run in different services, joined at read time.
- **Operational visibility depends on execution telemetry being wired up per workflow** (an n8n execution webhook has to be configured per automation) — until then, it falls back to a weaker heuristic.
- **The ROI/business-value modeling has real inputs (shadow-model counts, incident counts, active policy counts pulled live from the data) but its dollar conversion factors are illustrative assumptions**, not derived from measured labor cost or actual API spend. Worth being precise about that distinction if a blog post cites a dollar figure from it.

## 9. Where it runs

The whole thing is live at `https://ioa.ea2sa.com` — nginx terminating TLS, reverse-proxying `/api/*` to the Kong gateway, serving a statically-built React SPA otherwise. Every score, dimension, and violation described above is running against real discovered workflow data, not a demo dataset.

---

*Angle suggestions for the blog itself: the "findings vs. decision-quality information" framing in §1 is a strong opener; the two-audience-two-numbers design in §4 is the most differentiated technical idea here and probably deserves to be the centerpiece; §8's honesty about gaps is worth keeping rather than editing out — "here's exactly where the automation ends and the human judgment begins" is a more credible governance story than a platform that claims to have solved everything.*
