// Explanatory content sourced from docs/*.docx
// Used by InfoTip components across the SPA.

export const help = {

  // ── Workflow Governance page ─────────────────────────────────────────────

  wf: {
    pageTitle:
      'You are not merely managing workflows — you are governing automation behavior, AI usage, data movement, and operational decisions. This is the transition from Traditional Automation to Intelligent Operational Governance. Very few organizations currently have visibility into this layer.',

    subtitle:
      'Three core functions: Risk Scoring evaluates each workflow for operational risk, security exposure, and AI safety posture. PII Detection inspects workflows for sensitive data — SSNs, emails, financial records, secrets. Policy Enforcement is the most strategic capability: the system moves from observing workflows to controlling them.',

    discoverButton:
      '"Discover" implies continuous observability — not uploading a file, but interrogating n8n APIs, crawling environments, classifying workflows, identifying AI usage, mapping integrations, and detecting policy drift. This turns the system into an operational discovery platform — an automation CMDB for operational intelligence.',

    importButton:
      'Manual ingestion of a specific workflow. The system fetches the full definition from n8n, parses the node graph, stores metadata, analyzes topology, and computes governance posture — similar to IaC scanning or CI/CD security scanning, but for operational automation.',

    discoveredCount:
      'Operational inventory intelligence. The platform now knows what automations exist, where they run, what technologies they use, and what risk they carry. This is your enterprise automation CMDB — a Configuration Management Database for operational intelligence, except instead of servers, you are cataloging intelligent behavior.',

    summaryTab:
      'High-level governance metrics: total workflows, high-risk count, AI-enabled workflows, external integrations, PII exposure, and compliance posture. Executive-facing — answers "what is our AI automation risk right now?"',

    workflowsTab:
      'Each workflow becomes a governable asset with its own risk score, owner classification, environment, AI usage profile, data sensitivity, and policy violations. This is where governance becomes actionable — every automation is an auditable entity.',

    nodeTypesTab:
      'Classification of behavior patterns — not just workflows, but the operational primitives of automation. You are building an automation taxonomy: revealing how automation operates, how AI behaves, how data flows, and where risks emerge. This is architectural intelligence.',

    // table columns
    colGovernanceType:
      'Categorizes automation behavior into operational types — an automation taxonomy. Not just node labels: what the workflow does and what governance concerns apply to each behavior category.',

    colTotalNodes:
      'How many operational components exist in this category across the entire automation estate. High counts indicate widespread usage and a larger governance surface to monitor and control.',

    colWorkflows:
      'How many workflows contain this node type. Reveals common patterns, governance concentration, and architectural dependencies — where a single risk factor may affect many workflows simultaneously.',

    colRiskFactors:
      'Semantic governance analysis — not just inventory but interpretation. Each risk factor represents a specific governance concern with real operational, security, or compliance implications that require policy action.',

    // governance types
    typeTransform:
      'Data manipulation nodes: JavaScript code, function nodes, data transformations, mapping, and parsing. These are business logic execution points — important because business logic can hide unsafe code, data leakage, hidden decisions, and policy bypasses.',

    typeAiInference:
      'Workflows that invoke AI reasoning systems — OpenAI, Claude, Gemini, Ollama, LangChain, MCP agents. This category reveals your organization\'s distributed AI behavior operating inside workflows. Exactly what enterprises currently lack visibility into. This becomes AI observability.',

    typeHttp:
      'External communication nodes where data exits or enters the organization — REST APIs, webhooks, SaaS integrations, internal microservices. These are integration boundaries, critical for security, compliance, data sovereignty, and exfiltration prevention.',

    typeDatabase:
      'Nodes that read or write to databases. These are data persistence boundaries — important for tracking what customer or operational data is stored, modified, or exposed by automation.',

    typeWebhook:
      'Entry points that expose automation to external callers. Each webhook is an attack surface — user-supplied input can reach internal logic, credentials, or AI prompts. Governs API exposure posture.',

    typeSchedule:
      'Autonomous triggers that run without human initiation. Combined with AI nodes and no approval gates, scheduled execution represents the highest autonomous risk profile — AI acting without oversight on a timer.',

    typeApproval:
      'Human-in-the-loop checkpoints. The presence of approval nodes significantly reduces autonomous risk — they represent deliberate governance design by the workflow author.',

    // risk factors
    riskArbitraryCode:
      'Function or Code nodes allow unrestricted JavaScript execution. Risks: hidden logic, credential exposure, malicious execution, filesystem access, and ungoverned automation behavior. A legitimate enterprise security and audit concern.',

    riskFileSystem:
      'Workflow code interacts with local storage. Risks: sensitive data access, secret exposure, unauthorized reads/writes, and persistence mechanisms. Moves governance closer to runtime operational security.',

    riskNoSystemPrompt:
      'AI behavior is unconstrained — no system prompt means no guardrails. Without system prompts: hallucination risk rises, behavior becomes inconsistent, unsafe outputs increase, and policy alignment disappears. A core enterprise AI governance concern.',

    riskNoTokenLimit:
      'AI token consumption is uncontrolled. Risks: runaway costs, excessive context exposure, prompt injection amplification, and denial-of-wallet scenarios. Your platform governs both AI financial exposure and operational behavior.',

    riskNoAuthHeader:
      'API calls may not authenticate properly. Risks: insecure integrations, anonymous calls to external services, accidental data exposure, and weak governance posture. This is API security posture analysis.',

    riskNoTimeout:
      'Operational resilience governance. Without timeouts: workflows hang indefinitely, cascading failures occur, retries explode, queues back up, and orchestration destabilizes. Operational engineering intelligence.',

    riskRawSql:
      'Direct SQL execution without parameterization or ORM protection. Risk: SQL injection, uncontrolled data access, bulk data extraction, or data destruction. Requires explicit policy and audit controls.',

    riskDeprecatedModel:
      'The workflow uses a model version that is no longer maintained or supported. Risks: unpatched vulnerabilities, degraded capability, and compliance gaps if the model falls outside approved usage.',
  },

  // ── AI Inference page ───────────────────────────────────────────────────

  inference: {
    pageTitle:
      'Monitor, govern, and audit all AI model activity across the enterprise in real time.',

    subtitle:
      'Unified visibility into AI assets, runtime activity, and business-impacting AI decisions.',

    modelsTab:
      'Manage approved AI models, providers, endpoints, and governance policies. The Models view acts as the enterprise AI asset registry — track approved and unapproved models, external vs internal AI systems, model versions, ownership, risk classifications, and compliance posture. This becomes the CMDB for AI systems.',

    requestsTab:
      'Observe real-time AI inference activity across workflows, applications, and agents. Every AI request is logged as an operational event — track prompts, workflow origin, invoking application, token consumption, latency, execution status, and policy evaluation results. This becomes distributed tracing for AI operations.',

    decisionsTab:
      'Track how AI influences operational decisions, workflows, and business outcomes. Capture the downstream effect of AI-generated outputs: workflow routing, approvals, escalations, recommendations, automated actions, and human overrides. This becomes enterprise AI decision governance.',

    registerModel:
      'Register and govern a new AI model or inference endpoint. Add a new AI provider, local model, or enterprise inference endpoint — capturing provider metadata, endpoint configuration, allowed use cases, ownership, policy bindings, and risk classification. This becomes onboarding for enterprise AI governance.',

    submitRequest:
      'Every inference submission is a governed transaction. The platform records what model was used, what input was provided, when it executed, and what decision followed. This creates a complete AI activity ledger for forensics, audit, and cost governance.',

    // Models table columns
    colName:
      'Registered AI model or inference source — identifies the AI system handling requests. Examples: GPT-4o, Claude Sonnet, Gemini, DeepSeek, local Ollama models, internal enterprise models. Enables multi-model governance and operational comparison.',

    colVersion:
      'Active model version or release identifier. Tracks the exact model build used during inference execution — important for reproducibility, auditing, rollback support, drift analysis, and compliance validation.',

    modelStatus:
      'Current operational state of the model. Active: approved for organizational use. Inactive: registered but not permitted to execute. Deprecated: historical record — kept for audit trail but no longer accepting requests. Status transitions are deliberate governance actions.',

    colEndpoint:
      'Registered API or inference endpoint for the model. Represents the execution interface used by applications, workflows, or agents — including SaaS AI providers, local inference servers, private enterprise endpoints, and gateway-managed inference APIs. Provides visibility into external AI dependencies and data flow boundaries.',

    sanctioned:
      'Governance approval status for enterprise usage. Sanctioned: reviewed, approved, and permitted for organizational use. Shadow AI (unsanctioned): operating without visibility into outputs, costs, data exposure, or compliance posture. One of the most important governance indicators on this page.',

    colActions:
      'Administrative governance actions for model lifecycle management — control operational access and lifecycle state of AI systems: Activate, Deprecate, Restrict, or Quarantine.',

    // Requests table columns
    colId:
      'Every AI interaction becomes a governed operational event with a unique transaction identifier. This enables later forensic tracing: who invoked it, what workflow triggered it, what prompt was used, what data was involved, what model responded, and what downstream actions occurred.',

    colModel:
      'Identifies which AI system executed the request. Multi-model governance: your platform can compare cost, latency, accuracy, hallucination rates, security posture, and business outcomes across OpenAI, Claude, Gemini, Ollama, and internal models. This is AI FinOps + AIOps.',

    colStatus:
      'The operational lifecycle state of the inference. Statuses can evolve to include: queued, running, completed, failed, timeout, rejected, policy_blocked, requires_approval, or hallucination_detected. This becomes AI runtime orchestration governance.',

    colCreated:
      'Inference execution time enables temporal AI analytics: usage trends, peak inference periods, operational dependency on AI, workflow frequency, model saturation, cost spikes, and incident correlation. This evolves into AI operational observability.',

    // Decisions
    decisions:
      'Decisions record what the AI influenced — not just that it ran. The outcome, confidence level, and policy applied are all captured. For regulated industries — finance, healthcare, insurance, government — this is the evidence layer that answers: "why did this automated decision happen?"',
  },

  // ── Governance page ──────────────────────────────────────────────────────

  governance: {
    pageTitle:
      'The governance module is the operational policy engine of the platform. Define operational guardrails, attach policies to workflows, agents, services, or users, detect risky behavior, enforce compliance, and create AI safety controls. This is the enterprise control plane for AI-enabled operations.',

    subtitle:
      'Policy Definitions are rules, controls, restrictions, and enforcement logic — from preventing PII from reaching external AI to blocking source-code uploads to detecting shadow AI. Entity Bindings determine what each policy applies to. Without bindings, policies exist but are not enforced anywhere. Bindings operationalize governance.',

    createPolicy:
      'Create a new governance policy — a named enforcement rule set. Policies start in draft state and become active when bound to operational entities. Each policy can carry multiple rules and apply to multiple entity types across the enterprise.',

    exportBundle:
      'Download policies as a portable JSON policy bundle — rules, settings and bindings, in a stable order so the file diffs cleanly in Git. Use it for backup, review, and reusing policies. Bindings reference this environment\'s workflow and server ids, so bundles are for the same environment today.',

    importBundle:
      'Load a policy bundle (JSON). You always see a validated preview first — nothing is written until you confirm. Imported policies land as Draft and Observe, whatever mode the file asks for; you activate them deliberately afterwards. A policy with the same name is rejected unless you choose to replace it.',

    unevaluatedRules:
      'This policy contains rule types the platform does not evaluate yet (e.g. prompt inspection, logging restriction, execution rate). Those rules are recorded but never checked, so activating or enforcing the policy will not protect against what they describe.',

    statusFilter:
      'Filter policies by lifecycle state: Active (live enforcement), Draft (under construction), Inactive (monitoring disabled), Archived (historical record). Governance lifecycle management — view only what is relevant to your current operational context.',

    colName:
      'The governance control domain name — e.g. PII-Protection, Shadow-AI-Detection, Source-Code-Exfiltration-Guard. Policy names identify the specific compliance, security, or operational behavior being governed across the enterprise.',

    colStatus:
      'Enforcement lifecycle state. Active: currently enforced against bound entities. Draft: authored but not yet live. Inactive: suspended without deletion — useful for troubleshooting, staged rollout, or incident response. Archived: historical record, no longer evaluated.',

    colVersion:
      'Governance revision number — tracks policy evolution over time. A policy evolves as coverage expands: v1 may only detect SSNs; v4 may detect PHI, PCI, customer secrets, and AI context poisoning. Required for auditability, policy rollback, and compliance validation.',

    colCreated:
      'Governance traceability timestamp. Answers: when was this policy introduced? Before or after an incident? Before a compliance audit? Before a production release? This becomes governance audit metadata for regulatory review.',

    policyStatus:
      'Active: currently enforced against all bound entities. Draft: authored but not yet live. Inactive: suspended without deletion — use for troubleshooting, staged rollout, or incident response. Archived: historical record only. Status transitions are deliberate governance actions.',

    enforcementMode:
      'Controls what a policy violation actually DOES at a request boundary, independent of the policy\'s draft/active/inactive/archived status. Observe: log the decision only, nothing is blocked or flagged to the caller — the safe default for a new or recently-changed policy. Warn: pass the request through but flag it (X-IOA-Warning header / workflow warning) and record a violation. Enforce: block the request (403 for MCP traffic, execution held for n8n workflows) and record a violation. Every decision in every mode is recorded in enforcement activity — flip to Warn or Enforce only after reviewing what Observe would have decided.',

    rules:
      'Rules are the executable governance logic layer — conditions that trigger enforcement actions. Multiple rules per policy allow compound logic: e.g. block external AI calls if the workflow contains PII AND risk score exceeds threshold AND no human approval gate exists.',

    addRule:
      'Create executable governance logic — define what should happen when a condition is true. Actions include: block, warn, quarantine, mask, redact, require_human_approval, log, notify_security, throttle, or escalate. This is governance-as-code.',

    ruleAction:
      'The enforcement behavior when this rule fires. Examples: block (prevent execution), warn (alert but allow), quarantine (isolate for review), mask (redact sensitive data), require_human_approval (pause for human oversight), escalate (trigger incident). Defines the operational consequence of a policy violation.',

    rulePriority:
      'Determines which rules win when multiple rules match the same event. Higher priority overrides lower — e.g. an emergency security block overrides a normal workflow allow. Enterprise policy orchestration for compound governance scenarios.',

    ruleCondition:
      'JSON-encoded detection logic defining matching conditions and operational triggers. Example: { "containsPII": true, "destination": "external-ai", "riskScore": { "gte": 70 } } — if a workflow contains PII AND sends data externally AND risk exceeds threshold, enforce the action. This is operational governance-as-code.',

    bindings:
      'Bindings attach a policy to specific operational entities — workflows, services, APIs, users, namespaces, models, or AI agents. Without bindings, governance has no operational scope. A binding makes enforcement active for that specific entity. Different entities can have different policy sets.',

    addBinding:
      'Attach this policy to an operational entity — making governance enforcement active for that specific object. Once bound, every operation against that entity is evaluated against this policy\'s rules. Governance with no bindings is declarative only.',

    entityType:
      'The type of enterprise asset this policy governs. Examples: workflow, service, api, user, namespace, model, agent, connector, prompt-template. Governance can span the full operational stack — from infrastructure services to AI agents.',

    entityId:
      'The specific operational object this policy applies to. Examples: n8n-order-processing, governance-service, slack-agent-prod, openai-gateway, github-sync-bot. Identifies the exact asset within the entity type being governed.',
  },

  // ── Escalation page ──────────────────────────────────────────────────────

  escalation: {
    pageTitle:
      'The escalation engine converts governance signals into operational incidents. When a workflow violates policy, a model behaves unexpectedly, or risk thresholds are breached, the rules engine triggers an incident with defined severity and ownership.',

    rules:
      'Escalation rules define what conditions trigger an incident, at what severity, and to whom. They are the bridge between passive governance observation and active operational response.',

    incidents:
      'An incident is a governance event that requires human attention. Open incidents represent unresolved governance gaps. Resolution closes the loop between detection and remediation — creating an auditable governance lifecycle.',
  },

  // ── ROI Intelligence page ────────────────────────────────────────────────

  roi: {
    pageTitle:
      'Total ROA™ — Return on Automation Intelligence — treats AI governance as a financial position, not a cost center. Ungoverned automation carries real financial risk: regulatory liability, SLA penalties, runaway inference costs, and audit preparation burden. Governance converts that risk into measured, auditable value.',

    liveMode:
      'Live Data mode replaces estimated inputs with real signals from your platform: unsanctioned models from the model registry, shadow AI exposure rate derived from workflow risk scans, and high-priority incidents from the escalation engine. The financial model then reflects your actual governance posture.',

    shadowRate:
      'The percentage of automated decisions being processed by AI models outside organizational oversight. Derived in Live Data mode from workflows scored as high-risk or unscored relative to total discovered workflows.',

    payback:
      'The month at which cumulative governance value (risk avoided + savings) exceeds the platform cost. Earlier payback reflects higher risk exposure in the current automation estate — more shadow AI, more PII in workflows, more uncontrolled inference spend.',
  },

  // ── Audit page ───────────────────────────────────────────────────────────

  audit: {
    pageTitle:
      'The audit log is an append-only compliance record — every governance decision, policy evaluation, and escalation trigger is recorded here. It is the evidence layer of the platform: required for regulatory review, incident investigation, and governance maturity reporting.',
  },

  // ── Telemetry page ───────────────────────────────────────────────────────

  telemetry: {
    pageTitle:
      'Telemetry captures operational signals from the automation estate over time — latency, error rates, token consumption, and throughput. Combined with governance data, telemetry reveals whether policy enforcement is degrading performance, and whether inference costs are trending within approved bounds.',
  },
}
