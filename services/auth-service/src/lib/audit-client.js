// EP-310-S5 — Fire-and-forget audit logging for auth events.
// Calls audit-service directly (internal network, no JWT required since
// audit-service's requireAuth accepts the INTERNAL_SERVICE_KEY credential).
// All calls are non-blocking: a failed audit write is logged to stderr but
// never propagates to the caller — auth operations must not break due to an
// audit outage.
const AUDIT_URL = process.env.AUDIT_SERVICE_URL || 'http://audit-service:3302';
const SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY;

async function emit(event) {
  try {
    await fetch(`${AUDIT_URL}/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(SERVICE_KEY ? { 'X-Internal-Service-Key': SERVICE_KEY } : {}),
      },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    console.error('[audit-client] failed to emit event:', err.message);
  }
}

export function logLogin({ username, userId, outcome, ip, metadata = {} }) {
  return emit({
    event_type: 'auth.login',
    actor_id: userId || username,
    actor_type: 'user',
    resource_type: 'session',
    resource_id: username,
    action: 'login',
    outcome,
    metadata_json: { ip, ...metadata },
  });
}

export function logLogout({ username, userId, ip }) {
  return emit({
    event_type: 'auth.logout',
    actor_id: userId || username,
    actor_type: 'user',
    resource_type: 'session',
    resource_id: username,
    action: 'logout',
    outcome: 'success',
    metadata_json: { ip },
  });
}

export function logAuthFailure({ reason, username, ip }) {
  return emit({
    event_type: 'auth.failure',
    actor_id: username || 'unknown',
    actor_type: 'user',
    resource_type: 'session',
    resource_id: username || 'unknown',
    action: 'authenticate',
    outcome: 'failure',
    metadata_json: { reason, ip },
  });
}

// Password changes are exactly the kind of security-sensitive auth event
// EP-310-S5 built this audit trail for. method distinguishes a user changing
// their own password (self_service, current password verified) from an
// admin resetting someone else's (admin_reset, no current password known) —
// actorId is the acting user in both cases, resource_id is whose password changed.
export function logPasswordChange({ username, userId, actorId, method, ip }) {
  return emit({
    event_type: 'auth.password_change',
    actor_id: actorId || userId || username,
    actor_type: 'user',
    resource_type: 'user',
    resource_id: userId || username,
    action: method,
    outcome: 'success',
    metadata_json: { username, ip },
  });
}

// EP-306-S12 — key exchange is the machine equivalent of a login; create/revoke are
// privileged access-management actions. Same audit trail human auth already gets.
export function logApiKeyEvent({ action, keyId, keyName, actorId, outcome, ip, metadata = {} }) {
  return emit({
    event_type: 'auth.api_key',
    actor_id: actorId || keyId || 'unknown',
    actor_type: actorId ? 'user' : 'api_key',
    resource_type: 'api_key',
    resource_id: keyId || keyName || 'unknown',
    action,
    outcome,
    metadata_json: { key_name: keyName, ip, ...metadata },
  });
}

// EP-204-F1 — agent identity lifecycle (create/revoke/credential-issue) is the
// non-human equivalent of a user's login/password-change trail. actorId is
// always the authenticated caller (the delegator); resource_id is the agent
// acted upon, distinct from the caller for every action here.
export function logAgentEvent({ action, agentId, agentName, actorId, outcome, ip, metadata = {} }) {
  return emit({
    event_type: 'auth.agent',
    actor_id: actorId || 'unknown',
    actor_type: 'user',
    resource_type: 'agent',
    resource_id: agentId || agentName || 'unknown',
    action,
    outcome,
    metadata_json: { agent_name: agentName, ip, ...metadata },
  });
}
