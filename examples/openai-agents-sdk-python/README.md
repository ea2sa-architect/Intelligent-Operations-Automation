# IOA-governed OpenAI Agents SDK agent

Reference integration for a Jupyter-notebook agent built on
[OpenAI's Agents SDK](https://github.com/openai/openai-agents-python),
registered as a real identity in IOA (EP-204's agent-identity system) with
its model calls gated through governance-service's `POST /enforce` — the
same generic decision endpoint every other adapter in this platform uses
(Kong's MCP proxy plugin, the n8n `enforcement-client.js`,
`ai-inference-service`'s own direct-request gateway). See
`../../docs/enforcement-adapter-contract.md` for the contract this follows.

## Why two `.env` files

Registering an agent identity, minting its credential, and registering a
model all require real admin permissions (`user:manage` / `inference:manage`
— see `services/auth-service/src/routes/agents.js`). Those should never sit
in a notebook's regular environment, reloaded every time you restart the
kernel. So:

| File | Holds | Used by | Committed? |
|---|---|---|---|
| `.env.admin` | `IOA_ADMIN_API_KEY` — real admin scope | `setup_agent.py` only, run manually | Never |
| `.env` | `IOA_AGENT_TOKEN` — a 15-min, narrowly-scoped delegation JWT | `ioa_adapter.py` / the notebook | Never |

`ioa_adapter.py` never imports or reads `.env.admin`. If the agent process
were ever compromised, the worst it can do with `IOA_AGENT_TOKEN` is what
its narrow `authority_scope` allows (`policy:read` only, by default —
enough to call `/enforce`, nothing else) for 15 minutes.

## Setup

```bash
pip install -r requirements.txt
cp .env.admin.example .env.admin   # fill in IOA_ADMIN_API_KEY
python setup_agent.py \
  --agent-name "my-notebook-agent" \
  --model-name gpt-4o --model-version 2026-08-01 --provider openai
cp .env.example .env               # paste in the script's printed values + your real OPENAI_API_KEY
jupyter notebook example_agent.ipynb
```

When the 15-minute credential expires, re-run `setup_agent.py` with
`--credential-only` and update `.env` — there's no self-refresh path an
agent can use on its own (by design: minting a credential is itself a
delegation act, see `agents.js`'s own comment on `POST /:id/credential`).

## What's actually governed

Every call the notebook makes through `governed_run()` (see
`example_agent.ipynb`) is checked against whatever `ai_model` policy is
seeded (Governance → Policies → "AI Model Direct-Request Governance" in the
SPA) — sanctioned-provider and data-classification checks, the same ones
`ai-inference-service`'s own `/inference` endpoint enforces. `GET
/api/auth/delegations` shows the audit trail: which registered agent
identity authorized which model call, when.

**Not covered by this integration**: individual tool calls the agent makes
(a separate `mcp_server`-asset integration), and no static analysis of the
notebook's own code — this registers the agent and gates its runtime model
calls, it doesn't scan the notebook the way `/ioa`'s workflow pipeline
statically scans n8n workflows. If you want that depth of assessment for
this agent later, that's a materially larger piece of work — ask about it
specifically rather than assuming this gets you there.

## Files

| File | Purpose |
|---|---|
| `setup_agent.py` | One-time (or refresh-time) admin script: registers the agent + model, mints a credential |
| `ioa_adapter.py` | Runtime adapter — `enforce_ai_model()`, called before every real model call |
| `example_agent.ipynb` | The actual notebook, wiring `ioa_adapter` into an `openai-agents` `Agent`/`Runner` |
| `.env.admin.example` / `.env.example` | Templates — copy, never commit the real files |
