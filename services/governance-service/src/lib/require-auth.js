// Epic 2, Feature 2.1 (AUTH-201) — verifies the IOA session JWT locally in
// this service, protecting both Kong-routed requests and direct-port access
// (Kong is DB-less/declarative here; dynamically managing per-user JWT
// Consumers there is a poor fit and would leave direct ports unprotected —
// see the architecture note in docs/IOA_Authentication_Authorization_Epic_Feature_Story_Plan.docx).
// Deliberately identical across every protected service rather than a
// shared npm package — this codebase duplicates small, pure, security-
// relevant modules on purpose (see credential-scanner.js) so each service
// stays independently deployable with no cross-service build coupling.
// AUTH-205's conformance suite (no token / malformed / expired / wrong
// audience / valid) is duplicated per service for the same reason.
//
// Extended beyond AUTH-201's literal scope for a real, pre-existing gap the
// WBS doesn't call out: several IOA services already call each other over
// plain HTTP with no browser session at all (workflow-governance-service ->
// telemetry-service/mcp-governance-service/governance-service). A shared
// secret (INTERNAL_SERVICE_KEY) is accepted as an alternate credential for
// exactly that case — checked first, falling through to session-JWT
// verification if absent. The corresponding HTTP clients attach it.
//
// AUTH-305 — double-submit CSRF check for session-cookie-authenticated
// mutating requests (POST/PUT/PATCH/DELETE). Service-key-authenticated
// requests are exempt — CSRF is a browser/ambient-cookie concern, and
// service-to-service calls carry no cookie a malicious page could ride on.
//
// AUTH-504 (superseded by EP-308-S4) — this used to also gate every mutating
// request on a coarse `permissions.includes('write')` check. Removed: none
// of the 5 named RBAC roles (EP-308-S1) carry the literal string 'write' —
// only named actions like 'policy:edit' — so that check 403'd every
// mutating request from every named role except platform-admin (which only
// passed by accident, via a wildcard grant that happened to include the
// legacy 'read'/'write' permission rows too). Permission enforcement now
// lives entirely in requirePermission() on each route (EP-308-S3/S4), which
// checks the specific action a route needs rather than a single blanket
// flag. requireAuth's job is identity + CSRF only.
//
// EP-306-S12 — also accepts the token via `Authorization: Bearer <jwt>`, not
// just the session cookie, so a non-browser client (the discovery-agent CLI,
// exchanging an API key for a short-lived JWT at POST /api-keys/exchange)
// can authenticate without ever holding a cookie jar. CSRF only applies to
// the cookie path — a Bearer token requires explicit header-setting code a
// malicious page can't do cross-origin, same reasoning as the
// INTERNAL_SERVICE_KEY exemption above.
//
// EP-204-S3 — an agent-issued token's sub is `agent:<uuid>` (see auth-
// service's routes/agents.js), distinct from a human user's bare-id sub or
// an API-key exchange's `api-key:<uuid>`. Unlike those two, an agent
// identity can be revoked mid-lifetime and that revocation must take effect
// immediately rather than waiting out the token's own 15-minute expiry — so
// this is the one token shape worth a DB check on the hot path. The other
// two (and the vastly more common human-session case) never touch the DB
// here at all.

import jwt from 'jsonwebtoken';
import pool from '../../db.js';

const ISSUER = 'ioa-auth-service';
const AUDIENCE = 'ioa-platform';
const COOKIE_NAME = process.env.AUTH_COOKIE_NAME || 'ioa_session';
const CSRF_COOKIE_NAME = process.env.AUTH_CSRF_COOKIE_NAME || 'ioa_csrf';
const CSRF_HEADER_NAME = 'x-csrf-token';
const MUTATING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

function unescapePem(value) {
  return value ? value.replace(/\\n/g, '\n') : value;
}

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

  const publicKey = unescapePem(process.env.AUTH_JWT_PUBLIC_KEY);
  if (!publicKey) {
    console.error('[require-auth] AUTH_JWT_PUBLIC_KEY is not configured');
    return res.status(500).json({ error: 'Authentication is not configured' });
  }

  let payload;
  try {
    payload = jwt.verify(token, publicKey, { algorithms: ['RS256'], issuer: ISSUER, audience: AUDIENCE });
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
    const csrfCookie = req.cookies?.[CSRF_COOKIE_NAME];
    const csrfHeader = req.headers[CSRF_HEADER_NAME];
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
// cross-service client in this codebase (audit-client.js, etc.) —
// governance-service being unreachable must not turn an already-correct
// 403 into something worse.
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

// EP-308-S3 — Per-action permission guard factory.
// Usage: router.post("/approve", requireAuth, requirePermission("mcp:approve"), handler)
// Internal service-key requests are exempt (same reasoning as CSRF exemption above).
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
