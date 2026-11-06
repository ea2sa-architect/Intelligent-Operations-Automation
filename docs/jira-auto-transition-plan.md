# Jira Auto-Transition Architecture Plan

Automatically transition Jira issues when Claude Code (or any AI agent) reports a story, feature, or epic as complete. The IOA platform acts as the governance and audit layer for all AI-driven Jira transitions.

## Core Mechanism

Jira exposes a transitions REST API:

```
GET  /rest/api/3/issue/{issueKey}/transitions   → list valid status transitions
POST /rest/api/3/issue/{issueKey}/transitions   → execute a transition
     Body: { "transition": { "id": "31" } }     → id comes from GET response
```

n8n has a native Jira node, or use the HTTP Request node directly. The engineering problem is not Jira — it is the **signal**: how does the system know a story is done?

---

## Three-Tier Architecture

### Tier 1 — Commit Convention → n8n → Jira (Available Now)

Commit messages carry the issue ID using a bracket convention:

```
[EP-310-S1] Implement JWT RS256 key rotation with 90-day auto-rotation
```

A git `post-push` hook (or CI step) fires an n8n webhook with the commit message. n8n extracts the issue key via regex and calls the Jira transition API.

**Status mapping:**
- `[EP-xxx-Sx]` in commit → Story transitions to `Done`
- `[EP-xxx-Fx]` in commit → Feature transitions to `Done` (after all child stories done)
- `[EP-xxx]` in commit → Epic transitions to `In Progress` (not Done — requires explicit close)

**Build list:**
- `.git/hooks/post-push` script that POSTs commit message to n8n webhook
- n8n workflow: Webhook → regex extract issue key → Jira node `transitionIssue`
- Jira transition ID map (fetch once from GET /transitions, hardcode per project)

**Effort:** ~1 day. Works immediately, no platform changes needed.

---

### Tier 2 — Claude Code Stop Hook → n8n → Jira (Near Term)

Claude Code supports shell hooks via `.claude/settings.json`. A `Stop` hook fires when Claude completes a session task.

**Hook config** (`.claude/settings.json`):
```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/jira-complete.sh"
          }
        ]
      }
    ]
  }
}
```

**Output convention** — Claude Code ends implementation responses with a structured completion signal:
```
COMPLETED: EP-310-S1, EP-310-S2
```

The hook script (`jira-complete.sh`) captures that line from Claude's output and POSTs to the n8n webhook.

**Build list:**
- `jira-complete.sh`: grep Claude output for `COMPLETED:` lines, POST to n8n
- n8n workflow: extend Tier 1 to accept this input format alongside commit messages
- Agreed output convention between Claude Code and the workflow

**Effort:** ~2 days. Requires Claude Code hook setup and output convention.

---

### Tier 3 — IOA Platform as Governance Layer (Vision / Sprint 4-5)

The full vision makes IOA self-referential: the platform governs the AI agents that are building the platform. Every AI-driven Jira transition is audited, attributed, and subject to approval workflows.

**Flow:**
```
Claude Code
    ↓  MCP tool call
mcp-governance-service       ← records AI action + completion event
    ↓
workflow-governance-service  ← triggers n8n workflow via existing webhook
    ↓
n8n
    ↓  Jira REST API
Jira issue → Done
    ↓
audit-service                ← logs: who, what AI agent, which issue, when
```

**Key addition: Jira MCP Server**

Either the official Atlassian MCP server or a lightweight adapter built on `mcp-governance-service`. When Claude Code completes EP-310-S1:

```
mcp_jira__transition_issue({ key: "EP-310-S1", status: "Done" })
```

That MCP call routes through the governance platform before reaching Jira.

**Governance rules (examples):**
- Story-level transitions: auto-approve (AI can close directly)
- Feature-level transitions: require all child stories Done (platform validates)
- Epic-level transitions: require human approval from governance officer

**Build list:**
- Jira MCP server exposing: `transition_issue`, `get_issue`, `add_comment`, `get_transitions`
- `mcp-governance-service` route to proxy/govern Jira MCP calls
- `workflow-governance-service` trigger rule: AI completion event → fire n8n
- n8n: update existing workflow to handle governance event envelope
- `audit-service`: new event type `jira_transition` with AI agent context

**Aligns with epics:** EP-306 (MCP Discovery), EP-308 (Fine-grained RBAC for approval gates), EP-307 (Auth — attribute transition to authenticated agent identity)

**Effort:** Sprint 4-5 of the implementation roadmap (~weeks 7-10).

---

## Phased Rollout

| Phase | When | Trigger | Audit |
|-------|------|---------|-------|
| **Tier 1** | Now | Git commit convention | None (Jira history only) |
| **Tier 2** | After Jira import | Claude Code Stop hook | None (n8n logs) |
| **Tier 3** | Sprint 4-5 | MCP tool call through IOA | Full audit trail in audit-service |

Start with Tier 1 for immediate tracking. Tier 2 adds Claude Code integration without platform dependency. Tier 3 is the target state once EP-306 and EP-307 are implemented.

---

## n8n Workflow Inputs (all tiers)

All tiers converge on the same n8n webhook. Standardise the payload schema early:

```json
{
  "source": "git-hook | claude-code | mcp-governance",
  "issueKey": "EP-310-S1",
  "targetStatus": "Done",
  "agentId": "claude-code | commit-sha | mcp-client-id",
  "timestamp": "2026-07-23T00:00:00Z",
  "context": "optional free text / commit message / completion note"
}
```

n8n workflow reads `targetStatus`, fetches available transitions from Jira, matches by name, executes. One workflow handles all three tiers by switching on `source`.

---

## Related Docs

- [IOA Enterprise Deployment Plan](IOA-Enterprise-Deployment-Plan.html) — implementation roadmap with sprint schedule
- [Keycloak Realm Config](keycloak-realm-ioa.json) — auth setup for the IOA platform
- EP-306 WBS — MCP Discovery Engine (covers Jira MCP server build)
- EP-307 WBS — Enterprise Auth (covers agent identity in audit records)
