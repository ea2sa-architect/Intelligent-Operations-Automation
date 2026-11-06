"""IOA enforcement adapter for an OpenAI Agents SDK agent.

Follows docs/enforcement-adapter-contract.md exactly: one call to
governance-service's generic POST /enforce before the protected action
(here, an actual OpenAI model call) happens. This module owns nothing about
policy evaluation — it just calls the decision endpoint and acts on the
answer, same as every other adapter in this platform (the Kong plugin, the
n8n enforcement-client, ai-inference-service's own governance-client.js).

No response caching here, unlike the Kong plugin's 5s cache — the contract
calls that out specifically for "high-volume hot paths" (proxied traffic on
every request); an interactive notebook's model calls aren't that, so a
cache would just be complexity with nothing to buy.

Runtime credential only — this module never registers an agent or mints a
credential itself. See setup_agent.py for that (deliberately separate: this
module needs only IOA_AGENT_TOKEN, a low-privilege 15-minute delegation
JWT; registering an agent or minting that token needs an admin-scoped
user:manage credential, which should never live in a notebook's regular
.env — see README.md).
"""
from __future__ import annotations

import os
import time
from dataclasses import dataclass
from typing import Any

import requests
from dotenv import load_dotenv

load_dotenv()

IOA_API_URL = os.environ.get("IOA_API_URL", "").rstrip("/")
IOA_AGENT_TOKEN = os.environ.get("IOA_AGENT_TOKEN", "")


class IoaEnforcementError(RuntimeError):
    """Raised when an action is blocked, or when /enforce is unreachable.

    Fail-closed, per the adapter contract: this IS the enforcement point for
    this agent's model calls, so an unreachable governance-service must stop
    the action, not silently let it through. Distinguishable from a real
    policy block via `.blocked_by` (None on a connectivity failure, a dict
    on a genuine policy block) so a caller can log/handle the two cases
    differently if it wants to.
    """

    def __init__(self, message: str, *, blocked_by: dict | None = None):
        super().__init__(message)
        self.blocked_by = blocked_by


@dataclass
class EnforceResult:
    decision: str  # "allow" | "warn" | "block"
    warnings: list[dict]
    events: list[dict]


def enforce_ai_model(
    model_id: str,
    *,
    data_classification: str | None = None,
    correlation_id: str | None = None,
) -> EnforceResult:
    """Calls POST /enforce for asset_type "ai_model" — the same governance
    path EP-201-F5 built for ai-inference-service's own direct-request
    gateway. `model_id` must already exist in ai_inference.models (see
    setup_agent.py); if it doesn't, governance-service has nothing to
    evaluate against and the call fails closed rather than silently no-op'ing.

    Raises IoaEnforcementError on a block decision, on missing config, or on
    any network failure (fail-closed — see module docstring). Returns
    normally (possibly with warnings) on allow/warn.
    """
    if not IOA_API_URL or not IOA_AGENT_TOKEN:
        raise IoaEnforcementError(
            "IOA_API_URL and IOA_AGENT_TOKEN must be set (see .env.example) "
            "— refusing to let a model call through ungoverned."
        )

    context: dict[str, Any] = {}
    if data_classification:
        context["dataClassification"] = data_classification

    try:
        res = requests.post(
            f"{IOA_API_URL}/api/governance/enforce",
            headers={"Authorization": f"Bearer {IOA_AGENT_TOKEN}"},
            json={
                "asset_type": "ai_model",
                "asset_id": model_id,
                "correlation_id": correlation_id,
                "context": context,
            },
            timeout=10,
        )
    except requests.RequestException as err:
        # Fail-closed — see IoaEnforcementError's docstring.
        raise IoaEnforcementError(f"governance-service unreachable: {err}") from err

    body = res.json()
    if res.status_code == 403 or body.get("decision") == "block":
        raise IoaEnforcementError(
            f"blocked by policy: {body.get('blocked_by', {}).get('message', 'no message')}",
            blocked_by=body.get("blocked_by"),
        )

    if body.get("warnings"):
        for w in body["warnings"]:
            print(f"[IOA warning] {w.get('policy_name')}: {w.get('message')}")

    return EnforceResult(
        decision=body.get("decision", "allow"),
        warnings=body.get("warnings", []),
        events=body.get("events", []),
    )


def token_seconds_remaining() -> int | None:
    """Best-effort: decodes the JWT's exp claim (no signature check — this
    is a local sanity check for the notebook author, not a security
    boundary) so a long-running notebook session can warn before the
    15-minute credential expires, instead of failing opaquely mid-run.
    Returns None if the token can't be parsed.
    """
    import base64
    import json as _json

    try:
        payload_b64 = IOA_AGENT_TOKEN.split(".")[1]
        padded = payload_b64 + "=" * (-len(payload_b64) % 4)
        payload = _json.loads(base64.urlsafe_b64decode(padded))
        return max(0, int(payload["exp"] - time.time()))
    except Exception:
        return None
