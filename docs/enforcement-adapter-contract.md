# Enforcement Adapter Contract

EP-201 — how to plug a new gateway, orchestrator, or service into IOA's runtime
enforcement without touching governance-service's internals.

## The shape

Every enforcement integration in this platform is a thin **adapter** — a small,
technology-specific piece of code that calls one generic, technology-neutral
**decision endpoint** before letting an action proceed. The adapter owns the
"how do I intercept this and how do I block/warn/allow it" question for its
own environment (a Kong plugin, an n8n webhook, a service's own route
handler). It never re-implements policy evaluation, violation creation, or
enforcement-mode logic — that all lives in governance-service, once, and every
adapter shares it.

```
Adapter (gateway/orchestrator/service-specific)
    │
    │  POST /enforce  { asset_type, asset_id, correlation_id, context? }
    ▼
governance-service (generic — no adapter knows or cares how this works)
    │
    │  { decision, blocked_by, warnings, events }
    ▼
Adapter enforces the decision in whatever way its environment requires
```

Nothing about `/enforce` mentions Kong, n8n, or any specific downstream
service — it takes an asset type and id, evaluates whatever policies are
bound to that asset (or, for a global check like EP-201-F5's AI model
governance, whatever policy is seeded for that rule type), and returns a
decision. Adding a new adapter is exclusively adapter-side work.

## The contract

**Request** — `POST /enforce`

| Field | Required | Meaning |
|---|---|---|
| `asset_type` | yes | One of the registered types (see "Asset types" below) |
| `asset_id` | yes | The id of the specific thing being evaluated |
| `correlation_id` | no | Propagate this platform-wide if your caller has one (EP-102) — links the enforcement decision into the same trace as everything else that happened in this request |
| `context` | no | Type-specific extra data an evaluator needs that isn't part of the asset's own stored state (e.g. EP-201-F5 passes `{ data_classification }` here, since that's a property of the *request*, not the model) |

**Response**

| Field | Meaning |
|---|---|
| `decision` | `"allow"` \| `"warn"` \| `"block"` |
| `blocked_by` | `null`, or `{ policy_id, policy_name, violation_id, message }` for the first policy that blocked |
| `warnings` | array of `{ policy_id, policy_name, violation_id, message }`, one per policy in `warn` mode with an open violation |
| `events` | every `governance.enforcement_events` row this call wrote — one per bound policy, including clean `allow` rows |

HTTP status is `403` on `decision: "block"`, `200` otherwise. A `warn`
decision also sets `X-IOA-Warning` to the semicolon-joined policy names —
adapters that can surface response headers to their caller should forward it.

## Semantics an adapter MUST get right

**Fail-closed, not fail-soft, if this call IS the enforcement point.** Most
cross-service clients in this codebase degrade gracefully when the service
they call is unreachable (see `governance-client.js`'s `evaluateServer`,
fail-soft by design — it's a scoring input, not a gate). An enforcement
adapter is different: if `/enforce` is unreachable and you let the action
through anyway, an `enforce`-mode policy protects nothing exactly when the
platform is unhealthy. Reference implementation:
`workflow-governance-service/src/lib/enforcement-client.js` — on any network
failure it synthesizes a `block` decision with `reason: "governance-service
unreachable"`, distinguishable in the adapter's own error branch from a real
policy block.

**Cache briefly if you're in a high-volume hot path, not indefinitely.**
`/enforce` re-runs full rule evaluation on every call — fine for an n8n
workflow start or a `POST /inference`, too expensive to call on every single
proxied MCP request. `kong-plugins/ioa-mcp-enforcement/handler.lua` caches
the decision per `(asset_type, asset_id)` for a short, configurable TTL
(`cache_ttl_seconds`, default 5s) using Kong's built-in `kong.cache`
(mlcache) — cluster/worker-aware with no extra nginx.conf coordination
needed. Match this pattern; don't cache for minutes.

**Check containment before you even ask.** Governance-service checks
`containment_state` for `workflow`/`mcp_server` assets before evaluating any
policy — a quarantined asset is blocked unconditionally, independent of
policy mode. If your asset type has an equivalent containment concept, wire
it in on the governance-service side (`CONTAINMENT_STATE_QUERIES` in
`enforcement.js`), not in the adapter.

**Run late relative to auth, early relative to the real action.** The Kong
plugin's `PRIORITY = 100` is deliberately lower than typical auth plugins
(key-auth ~1003, jwt ~1005, acl ~950) — an unauthenticated request never
reaches `/enforce` at all. Whatever ordering primitive your environment has
(Kong plugin priority, Express middleware order, n8n node sequencing), put
the enforcement check after identity is established and before the
protected action actually happens.

## Reference adapters

| Adapter | File | Asset type | Notes |
|---|---|---|---|
| Kong (MCP proxy traffic) | `kong-plugins/ioa-mcp-enforcement/handler.lua` | `mcp_server` | Lua, Kong PDK, 5s decision cache |
| n8n (workflow execution) | `services/workflow-governance-service/src/lib/enforcement-client.js` | `workflow` | Called from a webhook n8n hits at workflow start (EP-201-S7); fails closed |
| ai-inference-service (direct model calls) | `services/ai-inference-service/src/lib/governance-client.js` (EP-201-F5) | `ai_model` | No proxy involved — a governance ledger asking permission before recording a `pending` request, not traffic interception |

## Building a new adapter

1. **Decide what "asset" means in your environment** and map it to
   `(asset_type, asset_id)`. If it's an existing type (`workflow`,
   `mcp_server`, `ai_model`), you're done with governance-service-side work —
   skip to step 3.
2. **New asset type only:** add an evaluator in
   `services/governance-service/src/lib/rule-evaluator.js`, register it in
   `ASSET_EVALUATORS` (`enforcement.js`) and, if it needs a new rule type not
   already in `governance.rule_schemas`, seed one (see
   `db/migrations/governance/032_ai_model_governance_policy.sql` for the
   template — rule_schemas entry, seeded policy, seeded policy_rules row).
3. **Write the adapter.** Call `POST /enforce` at the point in your
   environment where the protected action is about to happen. Decide
   fail-open vs fail-closed (almost always fail-closed — see above). Decide
   your cache TTL if this is a hot path. Handle all three decisions:
   `block` → refuse the action and surface `blocked_by.message`; `warn` →
   let it through, surface the warning somewhere your caller can see it;
   `allow` → proceed normally.
4. **Propagate `correlation_id`** if your environment already has one
   (an incoming header, a prior service call's response) so the enforcement
   decision joins the same trace as everything else.
5. **Add the adapter to the reference table above** once it's live.

## Non-goals

This contract does not cover authentication (see
`docs/IOA_Authentication_Authorization_Epic_Feature_Story_Plan.docx` and
EP-204) or evidence collection (EP-301). It is specifically the
"should this action be allowed to proceed right now" decision — one call,
one of three answers, every adapter identical from governance-service's side
regardless of what's on the other end of the wire.
