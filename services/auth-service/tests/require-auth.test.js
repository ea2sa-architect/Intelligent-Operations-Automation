import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));

import requireAuth, { requirePermission } from '../src/lib/require-auth.js';
import pool from '../db.js';

// AUTH-205-style conformance suite for auth-service's own copy of require-auth.js.
// auth-service issues sessions via jwtLib rather than verifying raw jsonwebtoken
// directly (see require-auth.js), so this mirrors the other 7 services'
// require-auth.test.js but signs tokens the same way jwtLib.verifyAccessToken expects.

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
  process.env.AUTH_JWT_PRIVATE_KEY = privateKey.replace(/\n/g, '\\n');
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

  it('accepts a valid token, calls next, and attaches user context to the request', () => {
    const { req, res, next } = makeReqRes(signToken());
    requireAuth(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBeNull();
    expect(req.user).toEqual({ id: 'user-1', username: 'admin', roles: [], permissions: [] });
  });

  describe('internal service key', () => {
    it('accepts a valid internal service key without requiring a session token', () => {
      const { req, res, next } = makeReqRes(null, { 'x-internal-service-key': 'test-internal-service-key' });
      requireAuth(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(req.user).toEqual({ id: 'internal-service', username: 'internal-service', isService: true });
    });

    it('rejects an incorrect service key', () => {
      const { req, res, next } = makeReqRes(null, { 'x-internal-service-key': 'wrong-key' });
      requireAuth(req, res, next);
      expect(res.statusCode).toBe(401);
      expect(next).not.toHaveBeenCalled();
    });
  });

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

    it('accepts a POST when the CSRF header matches the CSRF cookie', () => {
      const { req, res, next } = makeReqRes(signToken(), { 'x-csrf-token': 'matching-value' }, { ioa_csrf: 'matching-value' }, 'POST');
      requireAuth(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.statusCode).toBeNull();
    });
  });

  // EP-306-S12 — a non-browser client (the discovery-agent CLI, exchanging an
  // API key for a short-lived JWT at POST /api-keys/exchange) has no cookie
  // jar, so the same JWT it gets back can also travel via Authorization: Bearer.
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
    req.user = { permissions: ['user:manage'] };
    requirePermission('user:manage')(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBeNull();
  });

  it('returns 403 when req.user lacks the required permission', () => {
    const { req, res, next } = makePermRes();
    req.user = { permissions: ['mcp:read'] };
    requirePermission('user:manage')(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('bypasses the check for internal-service-key-authenticated requests', () => {
    const { req, res, next } = makePermRes();
    req.user = { isService: true };
    requirePermission('user:manage')(req, res, next);
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
      requirePermission('user:manage')(req, res, next);
      expect(res.statusCode).toBe(403);
      expect(next).not.toHaveBeenCalled();

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, opts] = global.fetch.mock.calls[0];
      expect(url).toContain('/violations/agent-security-event');
      const body = JSON.parse(opts.body);
      expect(body.agent_id).toBe('agent-1');
      expect(body.rule_type).toBe('agent_privilege_escalation');
    });

    it('does not report anything for a denied human-session token', () => {
      const { req, res, next } = makePermRes();
      req.user = { id: 'user-1', username: 'admin', permissions: ['mcp:read'] };
      requirePermission('user:manage')(req, res, next);
      expect(res.statusCode).toBe(403);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('still returns 403 even if the violation report itself fails', () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('governance-service unreachable'));
      const { req, res, next } = makePermRes();
      req.user = { id: 'agent:agent-1', username: 'my-agent', permissions: [] };
      requirePermission('user:manage')(req, res, next);
      expect(res.statusCode).toBe(403);
      expect(next).not.toHaveBeenCalled();
    });
  });
});
