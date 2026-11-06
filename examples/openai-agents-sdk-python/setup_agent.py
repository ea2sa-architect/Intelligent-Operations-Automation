"""One-time (or occasional, to refresh the credential) admin setup for an
OpenAI Agents SDK notebook agent — registers the agent identity, registers
the model it calls, and mints a runtime credential.

Deliberately a separate script/credential from ioa_adapter.py's runtime
path. POST /agents, POST /agents/:id/credential, and POST /models all
require user:manage / inference:manage — real admin permissions. Those
should never live in a notebook's regular, frequently-reloaded .env; this
script reads its own admin key from IOA_ADMIN_API_KEY (put it in
.env.admin, gitignored, loaded only when you run this script directly —
never imported by ioa_adapter.py or the notebook itself) and only ever
prints the low-privilege values (IOA_AGENT_TOKEN, model/agent ids) that
belong in the notebook's real .env.

Usage:
    IOA_ADMIN_API_KEY=ioak_... python setup_agent.py \\
        --agent-name "budget-notebook-agent" \\
        --model-name gpt-4o --model-version "2026-08-01" --provider openai

Re-run with --credential-only once the agent/model already exist and you
just need a fresh 15-minute token (auth.agents' credential TTL is fixed —
see auth-service/src/routes/agents.js — there's no self-refresh path the
notebook can use on its own; every reissue needs this admin step).
"""
from __future__ import annotations

import argparse
import os
import sys

import requests
from dotenv import load_dotenv

load_dotenv(".env.admin")

IOA_API_URL = os.environ.get("IOA_API_URL", "").rstrip("/")
ADMIN_API_KEY = os.environ.get("IOA_ADMIN_API_KEY", "")


def _exchange(base_url: str, api_key: str) -> str:
    res = requests.post(f"{base_url}/api/auth/api-keys/exchange", json={"api_key": api_key}, timeout=10)
    res.raise_for_status()
    return res.json()["token"]


def _find_agent(base_url: str, token: str, name: str) -> dict | None:
    res = requests.get(f"{base_url}/api/auth/agents", headers={"Authorization": f"Bearer {token}"}, timeout=10)
    res.raise_for_status()
    return next((a for a in res.json() if a["name"] == name and not a.get("revoked_at")), None)


def _register_agent(base_url: str, token: str, name: str, scope: list[str]) -> dict:
    res = requests.post(
        f"{base_url}/api/auth/agents",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": name, "type": "ai_agent", "scope": scope},
        timeout=10,
    )
    res.raise_for_status()
    return res.json()


def _find_or_register_model(base_url: str, token: str, name: str, version: str, provider: str) -> dict:
    res = requests.get(f"{base_url}/api/inference/models", headers={"Authorization": f"Bearer {token}"}, timeout=10)
    res.raise_for_status()
    existing = next((m for m in res.json() if m["name"] == name and m["version"] == version), None)
    if existing:
        return existing

    res = requests.post(
        f"{base_url}/api/inference/models",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": name, "version": version, "metadata_json": {"provider": provider}},
        timeout=10,
    )
    res.raise_for_status()
    model = res.json()
    print(
        f"! Registered model {name}/{version} with provider unset/is_sanctioned=false "
        f"(POST /models has no way to set either — a pre-existing gap in this API, "
        f"not something this script works around). If this model should be treated "
        f"as sanctioned, that's a deliberate governance call — set it directly via "
        f"the SPA's AI Inference admin view or governance-service's DB, not silently "
        f"here.",
        file=sys.stderr,
    )
    return model


def _issue_credential(base_url: str, token: str, agent_id: str, scope: list[str]) -> dict:
    res = requests.post(
        f"{base_url}/api/auth/agents/{agent_id}/credential",
        headers={"Authorization": f"Bearer {token}"},
        json={"authority_scope": scope},
        timeout=10,
    )
    res.raise_for_status()
    return res.json()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--agent-name", required=True)
    parser.add_argument("--model-name", required=True)
    parser.add_argument("--model-version", required=True)
    parser.add_argument("--provider", required=True)
    parser.add_argument("--credential-only", action="store_true", help="skip registration, just mint a fresh credential for an existing agent")
    args = parser.parse_args()

    if not IOA_API_URL or not ADMIN_API_KEY:
        sys.exit("IOA_API_URL and IOA_ADMIN_API_KEY must be set (put them in .env.admin, not .env)")

    admin_token = _exchange(IOA_API_URL, ADMIN_API_KEY)
    scope = ["policy:read"]  # enforce_ai_model only ever reads a decision — no write scope needed at runtime

    agent = _find_agent(IOA_API_URL, admin_token, args.agent_name)
    if agent is None:
        if args.credential_only:
            sys.exit(f"--credential-only given but no existing agent named {args.agent_name!r} was found")
        agent = _register_agent(IOA_API_URL, admin_token, args.agent_name, scope)
        print(f"✔ Registered agent {agent['name']} ({agent['id']})")
    else:
        print(f"✔ Agent {agent['name']} ({agent['id']}) already registered")

    model = _find_or_register_model(IOA_API_URL, admin_token, args.model_name, args.model_version, args.provider)
    print(f"✔ Model {model['name']}/{model['version']} ({model['id']})")

    credential = _issue_credential(IOA_API_URL, admin_token, agent["id"], scope)
    print(f"✔ Credential issued, expires in {credential['expires_in']}s\n")

    print("Put these in the notebook's real .env (NOT .env.admin):")
    print(f"IOA_API_URL={IOA_API_URL}")
    print(f"IOA_AGENT_TOKEN={credential['token']}")
    print(f"IOA_MODEL_ID={model['id']}")


if __name__ == "__main__":
    main()
