import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));

import requireAuth, { requirePermission } from '../src/lib/require-auth.js';
import pool from '../db.js';

// AUTH-205 — conformance suite: no token, malformed token, expired token,
// wrong audience, valid token. Identical across every protected service by
// design (see require-auth.js's header comment) — this file is duplicated
// verbatim, not imported, so each service's own test run proves its own
// copy behaves correctly rather than trusting one shared instance.

const ORIGINAL_ENV = { ...process.env };
const ISSUER = 'ioa-auth-service';
const AUDIENCE = 'ioa-platform';

let privateKeyPem;

beforeAll(() => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  privateKeyPem = privateKey;
  process.env.AUTH_JWT_PUBLIC_KEY = publicKey.replace(/\n/g, '\\n');
  process.env.INTERNAL_SERVICE_KEY = 'test-internal-service-key';
});
afterAll(() => { process.env = { ...ORIGINAL_ENV }; });

function makeReqRes(cookieValue, headers = {}, extraCookies = {}, method = 'GET') {
  const req = { cookies: { ...(cookieValue ? { ioa_session: cookieValue } : {}), ...extraCookies }, headers, method };
  const res = {
    statusCode: null, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  const next = vi.fn();
  return { req, res, next };
}

function signToken({ payload = {}, expiresIn = '60m', issuer = ISSUER, audience = AUDIENCE, key = privateKeyPem } = {}) {
  return jwt.sign({ sub: 'user-1', username: 'admin', ...payload }, key, { algorithm: 'RS256', expiresIn, issuer, audience });
}

describe('requireAuth', () => {
  it('rejects a request with no token', () => {
    const { req, res, next } = makeReqRes();
    requireAuth(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a malformed token', () => {
    const { req, res, next } = makeReqRes('not-a-real-token');
    requireAuth(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects an expired token', () => {
    const { req, res, next } = makeReqRes(signToken({ expiresIn: '-10s' }));
    requireAuth(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a token with the wrong audience', () => {
    const { req, res, next } = makeReqRes(signToken({ audience: 'some-other-app' }));
    requireAuth(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a token with the wrong issuer', () => {
    const { req, res, next } = makeReqRes(signToken({ issuer: 'not-ioa-auth-service' }));
    requireAuth(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a token signed with a different key pair', () => {
    const { privateKey: otherKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const { req, res, next } = makeReqRes(signToken({ key: otherKey }));
    requireAuth(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts a valid token, calls next, and attaches user context to the request', () => {
    const { req, res, next } = makeReqRes(signToken());
    requireAuth(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBeNull();
    expect(req.user).toEqual({ id: 'user-1', username: 'admin', roles: [], permissions: [] });
  });

  it('fails closed (500, not a silent pass-through) when AUTH_JWT_PUBLIC_KEY is not configured', () => {
    const saved = process.env.AUTH_JWT_PUBLIC_KEY;
    delete process.env.AUTH_JWT_PUBLIC_KEY;
    const { req, res, next } = makeReqRes(signToken());
    requireAuth(req, res, next);
    expect(res.statusCode).toBe(500);
    expect(next).not.toHaveBeenCalled();
    process.env.AUTH_JWT_PUBLIC_KEY = saved;
  });

  // Extended beyond AUTH-201's literal scope — service-to-service calls
  // (e.g. workflow-governance-service -> telemetry-service) carry no
  // browser session at all; the shared internal service key is the
  // alternate credential for exactly that case.
  describe('internal service key', () => {
    it('accepts a valid internal service key without requiring a session token', () => {
      const { req, res, next } = makeReqRes(null, { 'x-internal-service-key': 'test-internal-service-key' });
      requireAuth(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.statusCode).toBeNull();
      expect(req.user).toEqual({ id: 'internal-service', username: 'internal-service', isService: true });
    });

    it('rejects an incorrect service key and does not fall back to treating it as valid', () => {
      const { req, res, next } = makeReqRes(null, { 'x-internal-service-key': 'wrong-key' });
      requireAuth(req, res, next);
      expect(res.statusCode).toBe(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects a service key when INTERNAL_SERVICE_KEY is not configured server-side', () => {
      const saved = process.env.INTERNAL_SERVICE_KEY;
      delete process.env.INTERNAL_SERVICE_KEY;
      const { req, res, next } = makeReqRes(null, { 'x-internal-service-key': 'test-internal-service-key' });
      requireAuth(req, res, next);
      expect(res.statusCode).toBe(401);
      expect(next).not.toHaveBeenCalled();
      process.env.INTERNAL_SERVICE_KEY = saved;
    });

    it('still falls through to session-token verification when no service key header is present', () => {
      const { req, res, next } = makeReqRes(signToken());
      requireAuth(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(req.user).toEqual({ id: 'user-1', username: 'admin', roles: [], permissions: [] });
    });
  });

  // AUTH-305 — double-submit CSRF check, session-cookie-authenticated
  // mutating requests only
  describe('CSRF protection', () => {
    it('does not require a CSRF token for a GET request', () => {
      const { req, res, next } = makeReqRes(signToken(), {}, {}, 'GET');
      requireAuth(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('rejects a POST with a valid session but no CSRF token at all', () => {
      const { req, res, next } = makeReqRes(signToken(), {}, {}, 'POST');
      requireAuth(req, res, next);
      expect(res.statusCode).toBe(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects a POST when the CSRF header does not match the CSRF cookie', () => {
      const { req, res, next } = makeReqRes(signToken(), { 'x-csrf-token': 'header-value' }, { ioa_csrf: 'cookie-value' }, 'POST');
      requireAuth(req, res, next);
      expect(res.statusCode).toBe(403);
      expect(next).not.toHaveBeenCalled();
    });

    it('accepts a POST when the CSRF header matches the CSRF cookie', () => {
      const { req, res, next } = makeReqRes(signToken(), { 'x-csrf-token': 'matching-value' }, { ioa_csrf: 'matching-value' }, 'POST');
      requireAuth(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.statusCode).toBeNull();
    });

    it('applies the same CSRF check to PUT, PATCH, and DELETE', () => {
      for (const method of ['PUT', 'PATCH', 'DELETE']) {
        const { req, res, next } = makeReqRes(signToken(), {}, {}, method);
        requireAuth(req, res, next);
        expect(res.statusCode).toBe(403);
        expect(next).not.toHaveBeenCalled();
      }
    });

    it('does not require a CSRF token for internal-service-key-authenticated requests', () => {
      const { req, res, next } = makeReqRes(null, { 'x-internal-service-key': 'test-internal-service-key' }, {}, 'POST');
      requireAuth(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  // EP-308-S4 — requireAuth no longer gates on a coarse 'write' permission;
  // that check 403'd every mutating request from every named RBAC role
  // except platform-admin (none of them carry the literal string 'write').
  // Permission enforcement is now per-route via requirePermission() below —
  // requireAuth's job here is identity + CSRF only.
  describe('requireAuth does not gate on permissions (moved to requirePermission per route)', () => {
    const csrfHeaders = { 'x-csrf-token': 'matching-value' };
    const csrfCookies = { ioa_csrf: 'matching-value' };

    it('allows a mutating request from a token with only named permissions, no literal "write"', () => {
      const { req, res, next } = makeReqRes(signToken({ payload: { permissions: ['policy:edit'] } }), csrfHeaders, csrfCookies, 'POST');
      requireAuth(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.statusCode).toBeNull();
    });

    it('allows a mutating request from a read-only token — CSRF is still enforced, permission is not', () => {
      const { req, res, next } = makeReqRes(signToken({ payload: { permissions: ['read'] } }), csrfHeaders, csrfCookies, 'POST');
      requireAuth(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.statusCode).toBeNull();
    });

    it('allows a mutating request when the token predates Epic 5 and carries no permissions claim at all', () => {
      const { req, res, next } = makeReqRes(signToken(), csrfHeaders, csrfCookies, 'POST');
      requireAuth(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.statusCode).toBeNull();
    });

    it('sets req.user.permissions from the token on a read request', () => {
      const { req, res, next } = makeReqRes(signToken({ payload: { permissions: ['read'] } }), {}, {}, 'GET');
      requireAuth(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(req.user.permissions).toEqual(['read']);
    });

    it('is unaffected for internal-service-key-authenticated requests', () => {
      const { req, res, next } = makeReqRes(null, { 'x-internal-service-key': 'test-internal-service-key' }, {}, 'POST');
      requireAuth(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  // EP-306-S12 — a non-browser client (the discovery-agent CLI, exchanging an
  // API key for a short-lived JWT) has no cookie jar, so the same JWT it
  // already gets can also travel via Authorization: Bearer.
  describe('Bearer token authentication', () => {
    it('accepts a valid token via Authorization: Bearer with no session cookie', () => {
      const { req, res, next } = makeReqRes(null, { authorization: `Bearer ${signToken()}` });
      requireAuth(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.statusCode).toBeNull();
      expect(req.user).toEqual({ id: 'user-1', username: 'admin', roles: [], permissions: [] });
    });

    it('rejects a header without the "Bearer " prefix', () => {
      const { req, res, next } = makeReqRes(null, { authorization: signToken() });
      requireAuth(req, res, next);
      expect(res.statusCode).toBe(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('prefers the session cookie over the Authorization header when both are present', () => {
      const cookieToken = signToken({ payload: { username: 'cookie-user' } });
      const headerToken = signToken({ payload: { username: 'header-user' } });
      const { req, res, next } = makeReqRes(cookieToken, { authorization: `Bearer ${headerToken}` });
      requireAuth(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(req.user.username).toBe('cookie-user');
    });

    it('does not require a CSRF token for a Bearer-authenticated mutating request', () => {
      const { req, res, next } = makeReqRes(null, { authorization: `Bearer ${signToken()}` }, {}, 'POST');
      requireAuth(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.statusCode).toBeNull();
    });

    it('still requires CSRF for a cookie-authenticated mutating request even if an Authorization header is also present', () => {
      const { req, res, next } = makeReqRes(signToken(), { authorization: `Bearer ${signToken()}` }, {}, 'POST');
      requireAuth(req, res, next);
      expect(res.statusCode).toBe(403);
      expect(next).not.toHaveBeenCalled();
    });
  });

  // EP-204-S3 — an agent-issued token's sub is `agent:<uuid>`; unlike a
  // human session or an api-key-exchanged token, revocation must take
  // effect immediately, so this is the one token shape that hits the DB.
  describe('agent-token revocation', () => {
    beforeEach(() => { pool.query.mockReset(); });

    function agentToken(payloadOverrides = {}) {
      return signToken({ payload: { sub: 'agent:agent-1', permissions: ['workflow:read'], ...payloadOverrides } });
    }

    it('accepts a valid, non-revoked, non-expired agent token', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ revoked_at: null, expires_at: null }] });
      const { req, res, next } = makeReqRes(agentToken());
      await requireAuth(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(req.user.id).toBe('agent:agent-1');
    });

    it('exposes delegation_id from the token as req.user.delegationId (EP-204-S5)', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ revoked_at: null, expires_at: null }] });
      const { req, res, next } = makeReqRes(agentToken({ delegation_id: 'delegation-1' }));
      await requireAuth(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(req.user.delegationId).toBe('delegation-1');
    });

    it('rejects a revoked agent token even though the JWT itself has not expired', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ revoked_at: new Date(), expires_at: null }] });
      const { req, res, next } = makeReqRes(agentToken());
      await requireAuth(req, res, next);
      expect(res.statusCode).toBe(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects a token for an agent identity that no longer exists', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      const { req, res, next } = makeReqRes(agentToken());
      await requireAuth(req, res, next);
      expect(res.statusCode).toBe(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects a token for an agent identity past its own expires_at', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ revoked_at: null, expires_at: new Date(Date.now() - 1000) }] });
      const { req, res, next } = makeReqRes(agentToken());
      await requireAuth(req, res, next);
      expect(res.statusCode).toBe(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('fails closed when the revocation check itself errors', async () => {
      pool.query.mockRejectedValueOnce(new Error('db unreachable'));
      const { req, res, next } = makeReqRes(agentToken());
      await requireAuth(req, res, next);
      expect(res.statusCode).toBe(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('never touches the DB for a regular user-session token', async () => {
      const { req, res, next } = makeReqRes(signToken());
      await requireAuth(req, res, next);
      expect(pool.query).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('never touches the DB for an api-key-exchanged token', async () => {
      const { req, res, next } = makeReqRes(signToken({ payload: { sub: 'api-key:key-1' } }));
      await requireAuth(req, res, next);
      expect(pool.query).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
    });
  });
});

// EP-308-S3/S4 — requirePermission had no dedicated test coverage; the
// per-permission-string enforcement it does is exactly what moved here out
// of requireAuth's old coarse check.
describe('requirePermission', () => {
  function makePermRes() {
    const req = {};
    const res = {
      statusCode: null, body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
    const next = vi.fn();
    return { req, res, next };
  }

  it('calls next when req.user has the required permission', () => {
    const { req, res, next } = makePermRes();
    req.user = { permissions: ['policy:edit'] };
    requirePermission('policy:edit')(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBeNull();
  });

  it('returns 403 when req.user lacks the required permission', () => {
    const { req, res, next } = makePermRes();
    req.user = { permissions: ['policy:read'] };
    requirePermission('policy:edit')(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when req.user has no permissions claim at all', () => {
    const { req, res, next } = makePermRes();
    req.user = {};
    requirePermission('policy:edit')(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('bypasses the check for internal-service-key-authenticated requests', () => {
    const { req, res, next } = makePermRes();
    req.user = { isService: true };
    requirePermission('policy:edit')(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBeNull();
  });

  // EP-204-S7 — an agent exceeding its delegated scope is worth a CRITICAL
  // violation report, not just a silent 403 the way a human's would be.
  describe('agent privilege-escalation reporting', () => {
    beforeEach(() => { global.fetch = vi.fn().mockResolvedValue({ ok: true }); });

    it('reports a violation when an agent-issued token is denied', () => {
      const { req, res, next } = makePermRes();
      req.user = { id: 'agent:agent-1', username: 'my-agent', permissions: ['workflow:read'] };
      requirePermission('mcp:approve')(req, res, next);
      expect(res.statusCode).toBe(403);
      expect(next).not.toHaveBeenCalled();

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, opts] = global.fetch.mock.calls[0];
      expect(url).toContain('/violations/agent-security-event');
      const body = JSON.parse(opts.body);
      expect(body.agent_id).toBe('agent-1');
      expect(body.agent_name).toBe('my-agent');
      expect(body.rule_type).toBe('agent_privilege_escalation');
      expect(body.message).toContain('mcp:approve');
    });

    it('does not report anything for a denied human-session token', () => {
      const { req, res, next } = makePermRes();
      req.user = { id: 'user-1', username: 'admin', permissions: ['policy:read'] };
      requirePermission('policy:edit')(req, res, next);
      expect(res.statusCode).toBe(403);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('does not report anything for a denied api-key-exchanged token', () => {
      const { req, res, next } = makePermRes();
      req.user = { id: 'api-key:key-1', username: 'ci-key', permissions: [] };
      requirePermission('policy:edit')(req, res, next);
      expect(res.statusCode).toBe(403);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('still returns 403 even if the violation report itself fails', () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('governance-service unreachable'));
      const { req, res, next } = makePermRes();
      req.user = { id: 'agent:agent-1', username: 'my-agent', permissions: [] };
      requirePermission('mcp:approve')(req, res, next);
      expect(res.statusCode).toBe(403);
      expect(next).not.toHaveBeenCalled();
    });
  });
});
