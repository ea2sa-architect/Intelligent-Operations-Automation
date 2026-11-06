import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest';
import crypto from 'crypto';
import request from 'supertest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
// mockUser is mutable per-test (see the asUserId regression tests below,
// which need to simulate an API-key-authenticated caller — a synthetic
// `api-key:<uuid>` id, not a real auth.users UUID).
let mockUser = { id: 'admin-id', username: 'admin', roles: ['admin'], permissions: ['user:manage'] };
vi.mock('../src/lib/require-auth.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual, // keep the real asUserId — agents.js imports it from this module
    default: (req, _res, next) => { req.user = mockUser; next(); },
    requirePermission: () => (_req, _res, next) => next(),
  };
});

// Real RSA keypair + real jwt.js, same approach as api-keys.test.js — proves the
// credential endpoint actually mints a verifiable token, not just a mocked stand-in.
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

const AGENT_ROW = {
  id: 'agent-1', name: 'workflow-42-runner', type: 'workflow', owner_user_id: 'admin-id',
  scope: ['workflow:read'], created_at: new Date().toISOString(), expires_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUser = { id: 'admin-id', username: 'admin', roles: ['admin'], permissions: ['user:manage'] };
});

describe('GET /agents', () => {
  it('returns the agent list', async () => {
    pool.query.mockResolvedValueOnce({ rows: [AGENT_ROW] });
    const res = await request(app).get('/agents');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('workflow-42-runner');
  });
});

describe('POST /agents', () => {
  it('returns 400 when name is missing', async () => {
    const res = await request(app).post('/agents').send({ type: 'workflow', scope: ['workflow:read'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/i);
  });

  it('returns 400 for an unknown type', async () => {
    const res = await request(app).post('/agents').send({ name: 'x', type: 'human', scope: ['workflow:read'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/type must be one of/i);
  });

  it('returns 400 when scope is missing or empty', async () => {
    const res = await request(app).post('/agents').send({ name: 'x', type: 'workflow', scope: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/scope/i);
  });

  it('returns 400 for an unknown scope permission', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] }); // permission lookup finds nothing
    const res = await request(app).post('/agents').send({ name: 'x', type: 'workflow', scope: ['not:a:real:scope'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unknown scope permissions/i);
  });

  it('registers a new agent identity', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ name: 'workflow:read' }] }) // scope validation
      .mockResolvedValueOnce({ rows: [AGENT_ROW] });                 // insert
    const res = await request(app).post('/agents').send({ name: 'workflow-42-runner', type: 'workflow', scope: ['workflow:read'] });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe('agent-1');
  });

  // Regression: caught live (not by this mocked suite — a real Postgres
  // UUID-column insert is what actually failed) while building the
  // examples/openai-agents-sdk-python setup script, which authenticates
  // via an API key, not a human login session.
  it('registers an agent for an API-key-authenticated caller without a real user UUID to own it', async () => {
    mockUser = { id: 'api-key:e1790d98-414e-435b-8102-73ca02d730dd', username: 'setup script', roles: [], permissions: ['user:manage'] };
    pool.query
      .mockResolvedValueOnce({ rows: [{ name: 'policy:read' }] })
      .mockResolvedValueOnce({ rows: [AGENT_ROW] });
    const res = await request(app).post('/agents').send({ name: 'notebook-agent', type: 'ai_agent', scope: ['policy:read'] });
    expect(res.status).toBe(201);

    const insertCall = pool.query.mock.calls[1];
    expect(insertCall[1][2]).toBeNull(); // owner_user_id — not the raw "api-key:..." string
  });
});

describe('DELETE /agents/:id', () => {
  it('revokes an active agent', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: AGENT_ROW.id, name: AGENT_ROW.name }] });
    const res = await request(app).delete(`/agents/${AGENT_ROW.id}`);
    expect(res.status).toBe(204);
  });

  it('returns 404 when agent not found or already revoked', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).delete('/agents/nonexistent');
    expect(res.status).toBe(404);
  });
});

describe('POST /agents/:id/credential', () => {
  it('returns 404 for an unknown agent', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post(`/agents/${AGENT_ROW.id}/credential`);
    expect(res.status).toBe(404);
  });

  it('returns 403 for a revoked agent', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ ...AGENT_ROW, revoked_at: new Date().toISOString() }] });
    const res = await request(app).post(`/agents/${AGENT_ROW.id}/credential`);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/revoked/i);
  });

  it('returns 403 for an expired agent identity', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ ...AGENT_ROW, expires_at: new Date(Date.now() - 1000).toISOString() }] });
    const res = await request(app).post(`/agents/${AGENT_ROW.id}/credential`);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/expired/i);
  });

  it('issues a 15-minute JWT scoped to the agent, sub prefixed agent:, and records a delegation', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [AGENT_ROW] })              // agent lookup
      .mockResolvedValueOnce({ rows: [{ id: 'delegation-1' }] }); // delegation insert
    const res = await request(app).post(`/agents/${AGENT_ROW.id}/credential`);
    expect(res.status).toBe(200);
    expect(res.body.expires_in).toBe(900);
    expect(res.body.delegation_id).toBe('delegation-1');

    const payload = jwtLib.verifyAccessToken(res.body.token);
    expect(payload.sub).toBe(`agent:${AGENT_ROW.id}`);
    expect(payload.permissions).toEqual(['workflow:read']);
    expect(payload.delegation_id).toBe('delegation-1');
    expect(payload.exp - payload.iat).toBe(15 * 60);
  });

  it('records a null initiating_user_id for an API-key-authenticated caller (same asUserId fix as POST /agents)', async () => {
    mockUser = { id: 'api-key:e1790d98-414e-435b-8102-73ca02d730dd', username: 'setup script', roles: [], permissions: ['user:manage'] };
    pool.query
      .mockResolvedValueOnce({ rows: [AGENT_ROW] })
      .mockResolvedValueOnce({ rows: [{ id: 'delegation-3' }] });
    const res = await request(app).post(`/agents/${AGENT_ROW.id}/credential`);
    expect(res.status).toBe(200);

    const insertCall = pool.query.mock.calls[1];
    expect(insertCall[1][0]).toBeNull(); // initiating_user_id
  });

  it('accepts a narrower authority_scope than the agent\'s full scope', async () => {
    const wideAgent = { ...AGENT_ROW, scope: ['workflow:read', 'mcp:read'] };
    pool.query
      .mockResolvedValueOnce({ rows: [wideAgent] })
      .mockResolvedValueOnce({ rows: [{ id: 'delegation-2' }] });
    const res = await request(app)
      .post(`/agents/${AGENT_ROW.id}/credential`)
      .send({ authority_scope: ['workflow:read'] });
    expect(res.status).toBe(200);

    const payload = jwtLib.verifyAccessToken(res.body.token);
    expect(payload.permissions).toEqual(['workflow:read']);
  });

  it('rejects an authority_scope broader than the agent\'s registered scope', async () => {
    pool.query.mockResolvedValueOnce({ rows: [AGENT_ROW] }); // scope: ['workflow:read']
    const res = await request(app)
      .post(`/agents/${AGENT_ROW.id}/credential`)
      .send({ authority_scope: ['workflow:read', 'mcp:approve'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/exceeds the agent's registered scope/i);
  });
});

describe('GET /delegations', () => {
  it('returns delegation records joined with initiator and agent identity', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{
        id: 'delegation-1', tool_id: null, authority_scope: ['workflow:read'],
        created_at: new Date().toISOString(), expires_at: new Date().toISOString(),
        initiating_user_id: 'admin-id', initiating_username: 'admin',
        agent_id: AGENT_ROW.id, agent_name: AGENT_ROW.name, agent_type: AGENT_ROW.type,
      }],
    });
    const res = await request(app).get('/delegations');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].initiating_username).toBe('admin');
    expect(res.body[0].agent_name).toBe(AGENT_ROW.name);
  });

  it('filters by agent_id', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get(`/delegations?agent_id=${AGENT_ROW.id}`);
    expect(res.status).toBe(200);
    expect(pool.query.mock.calls[0][0]).toMatch(/d\.agent_id = \$1/);
    expect(pool.query.mock.calls[0][1]).toEqual([AGENT_ROW.id]);
  });
});
