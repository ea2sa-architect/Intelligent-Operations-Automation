// EP-308-S3 — Per-action permission guard factory.
// Usage: router.post("/approve", requireAuth, requirePermission("mcp:approve"), handler)
// Internal service-key requests are exempt (same reasoning as CSRF exemption above).
//
// auth-service does not apply requireAuth globally (it issues sessions, not
// consumes them), but the middleware is available for per-route use on the
// user-management API endpoints added in EP-308-S7.
//
// EP-306-S12 — also accepts the token via `Authorization: Bearer <jwt>`, not
// just the session cookie, so a non-browser client can authenticate without
// a cookie jar (e.g. the discovery-agent CLI, exchanging an API key for a
// short-lived JWT at POST /api-keys/exchange). CSRF only applies to the
// cookie path — a Bearer token requires explicit header-setting code a
// malicious page can't do cross-origin, same reasoning as the
// INTERNAL_SERVICE_KEY exemption above.
//
// EP-204-S3 — an agent-issued token's sub is `agent:<uuid>` (see
// routes/agents.js), distinct from a human user's bare-id sub or an
// API-key exchange's `api-key:<uuid>`. Unlike those two, an agent identity
// can be revoked mid-lifetime and that revocation must take effect
// immediately rather than waiting out the token's own 15-minute expiry — so
// this is the one token shape worth a DB check on the hot path.

import jwtLib from './jwt.js';
import pool from '../../db.js';

// req.user.id below takes one of four shapes: a bare auth.users UUID (human
// session/login), `api-key:<uuid>` (API-key exchange), `agent:<uuid>`
// (agent-issued credential), or the literal string 'internal-service'
// (X-Internal-Service-Key path). Only the first is a real FK-able UUID —
// inserting any of the other three into a UUID-typed owner/actor column
// throws a hard Postgres error, not a graceful null. Routes that persist
// req.user.id into such a column (owner_user_id, created_by,
// initiating_user_id) must run it through this first. A bare-colon check
// isn't quite right ('internal-service' has no colon either, but also isn't
// a UUID) — match the actual UUID shape instead.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const asUserId = id => (typeof id === 'string' && UUID_RE.test(id)) ? id : null;

const COOKIE_NAME     = process.env.AUTH_COOKIE_NAME || 'ioa_session';
const CSRF_COOKIE_NAME = process.env.AUTH_CSRF_COOKIE_NAME || 'ioa_csrf';
const CSRF_HEADER_NAME = 'x-csrf-token';
const MUTATING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

export default async function requireAuth(req, res, next) {
  const serviceKey = req.headers['x-internal-service-key'];
  if (serviceKey && process.env.INTERNAL_SERVICE_KEY && serviceKey === process.env.INTERNAL_SERVICE_KEY) {
    req.user = { id: 'internal-service', username: 'internal-service', isService: true };
    return next();
  }

  const cookieToken = req.cookies?.[COOKIE_NAME];
  const authHeader = req.headers['authorization'];
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const token = cookieToken || bearerToken;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  let payload;
  try {
    payload = jwtLib.verifyAccessToken(token);
  } catch {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  if (typeof payload.sub === 'string' && payload.sub.startsWith('agent:')) {
    const agentId = payload.sub.slice('agent:'.length);
    try {
      const { rows: [agent] } = await pool.query(
        'SELECT revoked_at, expires_at FROM auth.agents WHERE id = $1',
        [agentId]
      );
      if (!agent || agent.revoked_at || (agent.expires_at && new Date(agent.expires_at) < new Date())) {
        return res.status(401).json({ error: 'Not authenticated' });
      }
    } catch (err) {
      console.error('[require-auth] agent revocation check failed:', err.message);
      return res.status(401).json({ error: 'Not authenticated' });
    }
  }

  if (MUTATING_METHODS.includes(req.method) && cookieToken) {
    const csrfCookie  = req.cookies?.[CSRF_COOKIE_NAME];
    const csrfHeader  = req.headers[CSRF_HEADER_NAME];
    if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
      return res.status(403).json({ error: 'Missing or invalid CSRF token' });
    }
  }

  req.user = {
    id: payload.sub, username: payload.username, roles: payload.roles || [], permissions: payload.permissions || [],
    // EP-204-S5 — present only on an agent-issued token; lets a route handler
    // tag any telemetry its action emits with the delegation that authorized it.
    delegationId: payload.delegation_id,
  };
  next();
}

const GOVERNANCE_URL = process.env.GOVERNANCE_SERVICE_URL || 'http://localhost:3300';

// EP-204-S7 — an agent-issued token failing a permission check isn't just a
// 403 like a human's would be: it's exactly the scope-overreach a
// delegation record exists to prevent, worth a CRITICAL violation an admin
// can see and act on (e.g. revoke the agent), not just a silent client
// error. Fire-and-forget, same fail-soft fetch pattern as every other
// cross-service client in this codebase — governance-service being
// unreachable must not turn an already-correct 403 into something worse.
function reportAgentPrivilegeEscalation({ agentId, agentName, action, grantedScope }) {
  fetch(`${GOVERNANCE_URL}/violations/agent-security-event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Service-Key': process.env.INTERNAL_SERVICE_KEY || '' },
    body: JSON.stringify({
      agent_id: agentId, agent_name: agentName, rule_type: 'agent_privilege_escalation',
      message: `Agent requested permission "${action}" outside its delegated scope [${grantedScope.join(', ')}]`,
    }),
  }).catch(err => console.error('[require-auth] failed to report agent privilege escalation:', err.message));
}

export function requirePermission(action) {
  return function permissionGuard(req, res, next) {
    if (req.user?.isService) return next();
    if (!req.user?.permissions?.includes(action)) {
      if (typeof req.user?.id === 'string' && req.user.id.startsWith('agent:')) {
        reportAgentPrivilegeEscalation({
          agentId: req.user.id.slice('agent:'.length), agentName: req.user.username,
          action, grantedScope: req.user.permissions ?? [],
        });
      }
      return res.status(403).json({ error: `Permission required: ${action}` });
    }
    next();
  };
}
