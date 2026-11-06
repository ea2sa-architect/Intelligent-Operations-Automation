import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest';
import crypto from 'crypto';
import request from 'supertest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
// mockUser mutable per-test, same pattern as agents.test.js — needed for the
// asUserId regression test below (an API-key-authenticated caller minting
// another key, e.g. the discovery-agent admin-setup flow).
let mockUser = { id: 'admin-id', username: 'admin', roles: ['admin'], permissions: ['user:manage'] };
vi.mock('../src/lib/require-auth.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual, // keep the real asUserId — api-keys.js imports it from this module
    default: (req, _res, next) => { req.user = mockUser; next(); },
    requirePermission: () => (_req, _res, next) => next(),
  };
});

// Real RSA keypair + real jwt.js, same approach as auth-routes.test.js — proves the
// exchange endpoint actually mints a verifiable token, not just a mocked stand-in.
beforeAll(() => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  process.env.AUTH_JWT_PRIVATE_KEY = privateKey.replace(/\n/g, '\\n');
  process.env.AUTH_JWT_PUBLIC_KEY = publicKey.replace(/\n/g, '\\n');
});

import pool from '../db.js';
import app from '../index.js';
import jwtLib from '../src/lib/jwt.js';
import { hashApiKey } from '../src/lib/api-keys.js';

const KEY_ROW = {
  id: 'key-1', name: 'discovery-agent', key_prefix: 'ioak_aaaaaaaa',
  scopes: ['mcp:register'], created_by: 'admin-id', created_at: new Date().toISOString(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUser = { id: 'admin-id', username: 'admin', roles: ['admin'], permissions: ['user:manage'] };
});

describe('GET /api-keys', () => {
  it('returns list, never including key_hash', async () => {
    pool.query.mockResolvedValueOnce({ rows: [KEY_ROW] });
    const res = await request(app).get('/api-keys');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].key_hash).toBeUndefined();
  });
});

describe('POST /api-keys', () => {
  it('returns 400 when name is missing', async () => {
    const res = await request(app).post('/api-keys').send({ scopes: ['mcp:register'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/i);
  });

  it('returns 400 when scopes is missing or empty', async () => {
    const res = await request(app).post('/api-keys').send({ name: 'agent' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/scopes/i);
  });

  it('returns 400 for an unknown scope', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] }); // permission lookup finds nothing
    const res = await request(app).post('/api-keys').send({ name: 'agent', scopes: ['not:a:real:scope'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unknown scopes/i);
  });

  it('creates a key and returns the raw key once, never a hash', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ name: 'mcp:register' }] }) // scope validation
      .mockResolvedValueOnce({ rows: [KEY_ROW] });                  // insert
    const res = await request(app).post('/api-keys').send({ name: 'discovery-agent', scopes: ['mcp:register'] });
    expect(res.status).toBe(201);
    expect(res.body.api_key).toMatch(/^ioak_/);
    expect(res.body.key_hash).toBeUndefined();
  });

  // Regression: caught live — an API-key-authenticated caller (a synthetic
  // `api-key:<uuid>` sub, not a real auth.users UUID) minting a further key
  // hit the same Postgres UUID-column error already fixed in agents.js.
  it('creates a key for an API-key-authenticated caller without a real user UUID to own it', async () => {
    mockUser = { id: 'api-key:e1790d98-414e-435b-8102-73ca02d730dd', username: 'setup script', roles: [], permissions: ['user:manage'] };
    pool.query
      .mockResolvedValueOnce({ rows: [{ name: 'mcp:register' }] })
      .mockResolvedValueOnce({ rows: [KEY_ROW] });
    const res = await request(app).post('/api-keys').send({ name: 'module7-mcp-demo admin key', scopes: ['mcp:register'] });
    expect(res.status).toBe(201);

    const insertCall = pool.query.mock.calls[1];
    expect(insertCall[1][4]).toBeNull(); // created_by — not the raw "api-key:..." string
  });
});

describe('DELETE /api-keys/:id', () => {
  it('revokes an active key', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: KEY_ROW.id, name: KEY_ROW.name }] });
    const res = await request(app).delete(`/api-keys/${KEY_ROW.id}`);
    expect(res.status).toBe(204);
  });

  it('returns 404 when key not found or already revoked', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).delete('/api-keys/nonexistent');
    expect(res.status).toBe(404);
  });
});

describe('POST /api-keys/exchange', () => {
  it('returns 400 when api_key is missing', async () => {
    const res = await request(app).post('/api-keys/exchange').send({});
    expect(res.status).toBe(400);
  });

  it('returns 401 with a generic message for an unknown or revoked key', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/api-keys/exchange').send({ api_key: 'ioak_bogus' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid or revoked/i);
  });

  it('exchanges a valid key for a 15-minute JWT carrying its scopes', async () => {
    const rawKey = 'ioak_' + 'a'.repeat(64);
    pool.query
      .mockResolvedValueOnce({ rows: [{ ...KEY_ROW, key_hash: hashApiKey(rawKey) }] }) // lookup
      .mockResolvedValueOnce({ rows: [] });                                             // last_used_at update

    const res = await request(app).post('/api-keys/exchange').send({ api_key: rawKey });
    expect(res.status).toBe(200);
    expect(res.body.scopes).toEqual(['mcp:register']);
    expect(res.body.expires_in).toBe(900);

    const payload = jwtLib.verifyAccessToken(res.body.token);
    expect(payload.sub).toBe(`api-key:${KEY_ROW.id}`);
    expect(payload.permissions).toEqual(['mcp:register']);
    expect(payload.exp - payload.iat).toBe(15 * 60);
  });
});
