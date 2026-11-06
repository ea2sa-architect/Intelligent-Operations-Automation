# n8n AI Governance Analysis Workflow — build spec

The receiving-side n8n workflow for `workflow-governance-service`'s `/workflows/:id/analyze`
step (`src/routes/analysis.js`). This is the workflow `N8N_ANALYSIS_WEBHOOK_URL` must point
at — it does not exist yet as of this writing; the URL currently configured in
`bootstrap/platform.config.yaml` is a stale placeholder that 404s.

## What this step is for

`risk-scorer.js` already produces a deterministic, rule-based risk score on `/score` —
no AI, purely structural (node types present, PII detected, approval/error-handling/logging
presence). `/analyze` is a second, qualitative layer on top of that same data: it hands the
already-computed risk profile to an LLM to produce a narrative governance write-up — the
kind of "why this combination of factors matters" reasoning a fixed scoring rubric can't
articulate on its own.

## The payload — fixed shape, built entirely by IOA

No per-workflow authoring is needed on the n8n side, and the payload does not vary in
*shape* between workflows — only in values. `analysis.js` (lines 44-77) builds it
automatically from data already captured during import/scoring (`workflow_nodes`,
`workflow_pii_exposure`, `risk_breakdown_json`):

```json
{
  "job_id": "uuid",
  "callback_url": "https://ioa.ea2sa.com/workflow-governance/workflows/analyze/callback/<job_id>",
  "workflow": {
    "name": "...", "risk_score": 72, "risk_level": "high",
    "tags": ["pii", "finance"],
    "top_risk_factors": ["..."],
    "node_count": 14,
    "node_types": { "http_request": 3, "approval": 0, "code": 2 },
    "has_approval_nodes": false,
    "has_error_handling": true,
    "has_logging": false,
    "pii_exposure": [{ "pii_type": "ssn", "node_name": "Format Report", "masked": false, "encrypted": false }],
    "risk_dimensions": { "...": "..." }
  }
}
```

The receiving n8n workflow never sees the target workflow's actual business nodes/logic —
only this pre-abstracted risk profile. That's why one AI-agent prompt covers every governed
workflow regardless of platform (n8n/Zapier/Make/etc.) or business purpose.

## Build: 3 nodes

### Node 1 — Webhook (trigger)

| Setting | Value |
|---|---|
| HTTP Method | `POST` |
| Path | anything memorable, e.g. `ioa-governance-analysis` |
| Respond | **Immediately** (default) |
| Response Code | `200` |

**"Respond Immediately" is required, not optional.** IOA's fetch to this webhook waits up
to 15s for a 2xx ack (`analysis.js:104-113`) — it does not wait for the analysis itself. The
real result comes back later via Node 3's separate callback POST. "Using Respond to Webhook
Node" instead would hold the connection open through the whole LLM call and risk hitting
IOA's 15s timeout.

**Must be Activated, not just saved/tested.** The URL handed back to IOA must be the
production form — `https://ea2sa.app.n8n.cloud/webhook/<path>` — never `/webhook-test/<path>`,
which only fires once per manual "Execute workflow" click and was the original cause of this
bug (config pointed at a test URL for a webhook ID that, on top of that, didn't exist in the
account at all).

### Node 2 — LLM call

Use a plain single-shot node (n8n's **Basic LLM Chain**, or a direct Anthropic/OpenAI
**Message a Model** node) — not the full "AI Agent" node. No tool use, no memory, no
multi-turn reasoning is needed; it's one prompt in, one narrative out.

**System prompt:**

```
You are a governance analyst reviewing an automated workflow's risk profile
for an AI/automation governance platform. You will receive a JSON object
describing a workflow's structural risk signals — NOT the workflow's actual
business logic, only pre-computed governance metadata.

Write a concise governance assessment (3-6 sentences) that:
1. States the overall risk posture in plain language, not just restating
   the numeric risk_score.
2. Calls out the specific combination of factors that matters most — e.g.
   PII exposure without masking/encryption, combined with no approval gate
   or no error handling, is materially worse than any one factor alone.
3. If pii_exposure is empty and has_approval_nodes/has_error_handling are
   both true, say plainly that the workflow looks well-governed rather than
   inventing concerns.
4. Ends with one concrete, actionable recommendation if risk_level is
   "high" or "critical"; omit the recommendation if risk_level is "low".

Output plain prose only — no markdown headers, no JSON, no preamble like
"Here is the analysis:".
```

**User prompt / input:**
```
{{ JSON.stringify($json.body.workflow, null, 2) }}
```

### Node 3 — HTTP Request (callback)

| Setting | Value |
|---|---|
| Method | `POST` |
| URL | `{{ $('Webhook').item.json.body.callback_url }}` |
| Body Content Type | JSON |
| Body | `{ "analysis": "={{ $json.text }}" }` |
| Headers | `Content-Type: application/json` |

The `$json.text` field name comes from Node 2's output — check the actual output key in
that node's result pane and adjust (e.g. an OpenAI chat node exposes `message.content`
instead of `text`).

This matches `analysis.js`'s callback contract exactly: `{ analysis: "<text>" }` is stored
verbatim in the `workflow_analyses.analysis` TEXT column and rendered as-is by the SPA
(`WorkflowGovernance.jsx:755`) — no markdown/JSON parsing on the IOA side, so Node 2's
system prompt asking for plain prose is load-bearing, not a style preference.

## Optional hardening (not required for the happy path to work)

- **Error branch.** Wire n8n's built-in error output on Node 2 (or a workflow-level Error
  Trigger) to instead POST `{ "error": "<message>" }` to the same `callback_url`.
  `analysis.js` already handles that shape — marks the job `failed` with that message
  instead of `completed`.
- **Callback signing.** `N8N_WEBHOOK_SECRET` is currently unset on IOA's side, so
  `POST /workflows/analyze/callback/:job_id` accepts any request unauthenticated
  (`verify-n8n-signature.js:14` — this is also tracked in `CLAUDE.md`'s "What has NOT been
  built yet" as "n8n callback authentication"). To close it: set `N8N_WEBHOOK_SECRET` in
  `bootstrap/platform.config.yaml`, then add matching `X-IOA-Signature: sha256=<HMAC-SHA256(rawBody, secret)>`
  and `X-IOA-Timestamp: <unix ms>` headers to Node 3's HTTP Request.

## Once built

Send the real production webhook URL so it can be wired into
`bootstrap/platform.config.yaml`'s `N8N_ANALYSIS_WEBHOOK_URL`, regenerated
(`node bootstrap/bootstrap-platform.js bootstrap --compose-only`), and the
`workflow-governance-service` container rebuilt — then verify end-to-end the same way the
Zapier enforcement connection was verified (real request in, real callback out, real row in
`workflow_analyses`).
