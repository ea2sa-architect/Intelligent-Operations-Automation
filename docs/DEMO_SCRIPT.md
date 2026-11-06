# IOA Demo Script

A ~20-minute walkthrough built around the executive primer's own lifecycle —
**Discover → Assess → Approve → Enforce → Observe** — using only capabilities
that are actually live today. Respond (kill switch/containment) and Improve
(ROI intelligence) are intentionally not in this script; they're roadmap, not
demo material. Positioning that honestly ("here's the control plane taking
shape") lands better with a technical audience than overclaiming.

## Before you present

```bash
docker compose up -d          # stack up
npm run migrate                # schema current
AUTH_ADMIN_PASSWORD=<your .env value> node scripts/demo-seed.js
```

The seed script prints a cheat sheet of every ID it creates — keep that
terminal visible or copy it somewhere you can glance at during the demo.

Log into the SPA (`http://localhost:5173`) as the admin account before you
start talking.

---

## 1. Discover (2 min) — "What's actually operating?"

**Screen:** MCP Registry (`/mcp-registry`)

Point at the list: four servers, different risk tiers, different statuses.
Say: *this is the governed inventory — every MCP server, tool, and prompt in
the environment, not just the ones someone remembered to document.*

Click into **demo-customer-data-connector-mcp**. Show the detail panel:
owner fields, approved use case, risk tier, publisher. *This is what
"accountability" means concretely — every asset has an owner and a stated
business purpose, not just a name in a spreadsheet.*

## 2. Assess (2 min) — "How risky is it?"

Still on that server, scroll to the risk breakdown (or hit **Score** if not
yet scored). Walk through 2-3 of the 8 dimensions — publisher trust,
authorization posture, data classification. *This is a consistent,
repeatable risk calculation, not a subjective gut check that varies by
reviewer.*

## 3. Approve (5 min) — the strongest capability in the platform today

**Screen:** MCP Registry → **demo-payment-processor-mcp**

This server is `critical` risk tier and sitting in `pending_review`. Click
**Approve**.

**The moment:** instead of flipping to `approved`, a dialog explains a
multi-stage approval chain just started. *A critical-risk asset doesn't get
rubber-stamped by one person clicking a button — the system itself enforces
separation of duties.*

Navigate to **Administration → Approval Chains**. Show the pending request.
Click **Decide** — narrate that the same-requester guard is live (you'll see
it refuse to let the requester also approve, if you're on the same account
you used to click Approve). If you have a second account, complete the
approval here and show the server flip to `approved` and Kong provisioning
fire in the server's status history.

**Secondary beat — waivers:** Administration → Waivers. Show the pending
waiver on the customer-data-connector server (*"vendor security review in
progress"*) — a full exception workflow with justification, an expiry date,
and the same separation-of-duties guard, for the case where the answer isn't
"approve the change," it's "accept the risk, temporarily, with a deadline."

## 4. Enforce (5 min) — "Can it actually stop something?"

**Screen:** Governance (`/governance`) → **demo-enforce-mode-policy**

Open the policy detail. Point at the mode selector: **Observe / Warn /
Enforce**. It's currently Observe. Click **Enforce** live — the UI updates
immediately, no redeploy, no config file.

Switch to the **Enforcement** page (`/enforcement`). Either:
- Trigger it via `POST /governance/enforce` from a terminal/Postman
  (`{"asset_type":"mcp_server","asset_id":"<customer-data server id>"}`) and
  show the 403 + the event landing in the list in real time, or
- If you set up the n8n gate ahead of time, trigger that workflow instead
  and show the same block surfacing through n8n.

*This is the "genuine control plane" claim from the primer, made concrete —
not a report that says something was non-compliant after the fact, a
decision that stopped it.*

**Be honest about scope here:** this demo shows the decision engine blocking
a request you triggered directly. Kong isn't yet sitting in front of *live*
MCP traffic in this environment — that's the next piece of wiring, not
something to imply is already true.

## 5. Observe (3 min) — "What actually happened?"

**Screen:** Enforcement page, scroll the event history. Point at the
per-policy breakdown — total decisions, warn/block counts. Then **Telemetry**
if you want a second data source — correlation IDs, cost/token tracking.

*Every decision in every mode is logged, including Observe — so turning on
Enforce later is an informed decision, not a guess.*

## Close (2 min) — honest roadmap framing

*What you just saw is Discover, Assess, Approve, and Enforce — the control
plane. What's next on the roadmap is Respond — kill switch and containment,
so a security team can suspend or quarantine something the moment this
system flags it — and Improve, connecting all of this to a risk/value view
so leadership can decide what to scale versus retire. That's deliberately
sequenced: control before optimization.*

---

## Resetting between run-throughs

`demo-seed.js` is not idempotent — it always creates new rows. Before a
second run-through, either:
- Retire/reject the demo servers and deactivate the demo policies/chain via
  the UI (keeps the audit trail, matches how this platform treats deletion
  everywhere else), or
- Restore the dev DB from a pre-seed snapshot if you took one.

Do not run `demo-seed.js` twice in a row without cleaning up first — you'll
get duplicate `demo-*` servers and a confusing registry list on stage.
