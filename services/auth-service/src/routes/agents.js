// EP-204-F1 — Agent identity registry. Distinct from auth.api_keys: an API
// key is one static long-lived secret a machine client holds and exchanges
// for a token; an agent identity is a registered, named non-human actor
// (workflow, AI agent, MCP client/server, tool) that an authenticated caller
// requests a short-lived credential *for* — no raw secret involved, and
// revocation takes effect immediately rather than waiting out a token's own
// expiry (checked live in every service's require-auth.js).

import { Router } from 'express';
import pool from '../../db.js';
import requireAuth, { requirePermission, asUserId } from '../lib/require-auth.js';
import jwtLib from '../lib/jwt.js';
import { logAgentEvent } from '../lib/audit-client.js';

const router = Router();
const wrap = fn => (req, res) => fn(req, res).catch(err => res.status(500).json({ error: err.message }));

const canManage = [requireAuth, requirePermission('user:manage')];

const AGENT_TYPES = ['workflow', 'ai_agent', 'agent_instance', 'mcp_client', 'mcp_server', 'tool'];
const CREDENTIAL_TTL = '15m';
const CREDENTIAL_TTL_SECONDS = 15 * 60;

// GET /agents — list. Nothing sensitive to redact here (unlike api_keys,
// there's no raw secret ever stored), but keep the response shape
// deliberately parallel to api-keys.js's list route.
router.get('/', ...canManage, wrap(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, type, owner_user_id, scope, created_at, expires_at, revoked_at
       FROM auth.agents
      ORDER BY created_at DESC`
  );
  res.json(rows);
}));

// POST /agents — register a new agent identity. scope reuses the existing
// auth.permissions catalog, same validation api-keys.js already does for
// api_key scopes — one permission vocabulary, not a parallel one.
router.post('/', ...canManage, wrap(async (req, res) => {
  const { name, type, scope, expires_at } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (!AGENT_TYPES.includes(type)) {
    return res.status(400).json({ error: `type must be one of: ${AGENT_TYPES.join(', ')}` });
  }
  if (!Array.isArray(scope) || scope.length === 0) {
    return res.status(400).json({ error: 'scope must be a non-empty array of permission names' });
  }

  const { rows: permRows } = await pool.query(
    'SELECT name FROM auth.permissions WHERE name = ANY($1::text[])',
    [scope]
  );
  if (permRows.length !== scope.length) {
    const found = permRows.map(p => p.name);
    const missing = scope.filter(s => !found.includes(s));
    return res.status(400).json({ error: `Unknown scope permissions: ${missing.join(', ')}` });
  }

  const { rows: [agent] } = await pool.query(
    `INSERT INTO auth.agents (name, type, owner_user_id, scope, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, type, owner_user_id, scope, created_at, expires_at`,
    [name.trim(), type, asUserId(req.user?.id), JSON.stringify(scope), expires_at ?? null]
  );

  logAgentEvent({
    action: 'create', agentId: agent.id, agentName: agent.name, actorId: req.user?.id,
    outcome: 'success', ip: req.ip || req.headers['x-forwarded-for'], metadata: { type, scope },
  });

  res.status(201).json(agent);
}));

// DELETE /agents/:id — revoke (soft-delete). Takes effect immediately: every
// service's require-auth.js checks revoked_at live on every request bearing
// an agent-issued token, not just at that token's own 15-minute expiry.
router.delete('/:id', ...canManage, wrap(async (req, res) => {
  const { rows: [agent] } = await pool.query(
    `UPDATE auth.agents SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL RETURNING id, name`,
    [req.params.id]
  );
  if (!agent) return res.status(404).json({ error: 'Agent not found or already revoked' });

  logAgentEvent({
    action: 'revoke', agentId: agent.id, agentName: agent.name, actorId: req.user?.id,
    outcome: 'success', ip: req.ip || req.headers['x-forwarded-for'],
  });

  res.status(204).end();
}));

// POST /agents/:id/credential — issue a short-lived JWT for a registered
// agent. The caller must already be authenticated and hold user:manage —
// unlike POST /api-keys/exchange, there's no raw secret being traded here;
// the request itself IS the delegation (EP-204-F2): every issuance records
// an auth.delegation_records row linking the caller's own identity to the
// agent and the specific authority handed over, and embeds that record's id
// in the minted JWT so anything the agent does downstream can be traced
// back to exactly which delegation authorized it.
//
// authority_scope defaults to the agent's full registered scope, but a
// caller can request a narrower slice for this one issuance (e.g. a single
// tool_id) — never a broader one than the agent itself was registered with.
router.post('/:id/credential', ...canManage, wrap(async (req, res) => {
  const { tool_id = null, authority_scope } = req.body ?? {};

  const { rows: [agent] } = await pool.query(
    `SELECT id, name, type, scope, expires_at, revoked_at FROM auth.agents WHERE id = $1`,
    [req.params.id]
  );
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  if (agent.revoked_at) return res.status(403).json({ error: 'Agent has been revoked' });
  if (agent.expires_at && new Date(agent.expires_at) < new Date()) {
    return res.status(403).json({ error: 'Agent identity has expired' });
  }

  const scope = authority_scope ?? agent.scope;
  const overreach = scope.filter(s => !agent.scope.includes(s));
  if (overreach.length > 0) {
    return res.status(400).json({ error: `authority_scope exceeds the agent's registered scope: ${overreach.join(', ')}` });
  }

  const delegationExpiresAt = new Date(Date.now() + CREDENTIAL_TTL_SECONDS * 1000);
  const { rows: [delegation] } = await pool.query(
    `INSERT INTO auth.delegation_records (initiating_user_id, agent_id, tool_id, authority_scope, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [asUserId(req.user?.id), agent.id, tool_id, JSON.stringify(scope), delegationExpiresAt]
  );

  const token = jwtLib.signAccessToken(
    { id: `agent:${agent.id}`, username: agent.name, roles: [], permissions: scope, delegationId: delegation.id },
    { expiresIn: CREDENTIAL_TTL }
  );

  logAgentEvent({
    action: 'credential_issue', agentId: agent.id, agentName: agent.name, actorId: req.user?.id,
    outcome: 'success', ip: req.ip || req.headers['x-forwarded-for'],
    metadata: { delegation_id: delegation.id, tool_id, authority_scope: scope },
  });

  res.json({
    token, agent_id: agent.id, type: agent.type, scope, delegation_id: delegation.id, expires_in: CREDENTIAL_TTL_SECONDS,
  });
}));

// GET /delegations (mounted at its own top-level path, see routes/index.js) —
// EP-204-S6's audit query: "who initiated, which agent acted, whose
// authority, what tool, what permissions." Joins back to auth.users and
// auth.agents for human-readable identity, not just ids. Filterable by
// agent_id, initiating_user_id, or tool_id — a full unfiltered scan is the
// exception (small admin-facing audit surface), not the norm.
export const delegationsRouter = Router();
delegationsRouter.get('/', ...canManage, wrap(async (req, res) => {
  const { agent_id, initiating_user_id, tool_id } = req.query;
  const conditions = [];
  const params = [];

  if (agent_id) { params.push(agent_id); conditions.push(`d.agent_id = $${params.length}`); }
  if (initiating_user_id) { params.push(initiating_user_id); conditions.push(`d.initiating_user_id = $${params.length}`); }
  if (tool_id) { params.push(tool_id); conditions.push(`d.tool_id = $${params.length}`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT d.id, d.tool_id, d.authority_scope, d.created_at, d.expires_at,
            u.id AS initiating_user_id, u.username AS initiating_username,
            a.id AS agent_id, a.name AS agent_name, a.type AS agent_type
       FROM auth.delegation_records d
       LEFT JOIN auth.users  u ON u.id = d.initiating_user_id
       LEFT JOIN auth.agents a ON a.id = d.agent_id
       ${where}
      ORDER BY d.created_at DESC`,
    params
  );
  res.json(rows);
}));

export default router;
