import { vi, describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
// Route tests exercise business logic, not auth — require-auth.js has its own dedicated conformance suite (tests/require-auth.test.js).
vi.mock('../src/lib/require-auth.js', () => ({ default: (req, _res, next) => next(), requirePermission: () => (_req, _res, next) => next() }));
// EP-101-S5 — avoid a real cross-service fetch to governance-service in route tests.
vi.mock('../src/lib/governance-client.js', () => ({ default: { evaluateServer: vi.fn(), recordApprovalDecision: vi.fn() } }));
import pool from '../db.js';
import governanceClient from '../src/lib/governance-client.js';
import app from '../index.js';

beforeEach(() => vi.clearAllMocks());

describe('POST /servers/:serverId/resources', () => {
  it('registers a resource', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'r1', server_id: 'srv-1', uri_template: 'https://files/{path}' }] });
    const res = await request(app).post('/servers/srv-1/resources').send({ uri_template: 'https://files/{path}' });
    expect(res.status).toBe(201);
    expect(res.body.credential_exposure_detected).toBe(false);
  });

  it('rejects a missing uri_template', async () => {
    const res = await request(app).post('/servers/srv-1/resources').send({});
    expect(res.status).toBe(400);
  });

  it('rejects an invalid sensitivity', async () => {
    const res = await request(app).post('/servers/srv-1/resources').send({ uri_template: 'x', sensitivity: 'top-secret' });
    expect(res.status).toBe(400);
  });

  // Epic 5, Feature 5.3 — a resource URI is the one field type this service
  // has that n8n node parameters never do: a basic-auth connection string.
  it('redacts a credential embedded in the uri_template and flags it', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'r1', server_id: 'srv-1', uri_template: 'postgres://dbuser:****ret@db.internal:5432/prod' }] }) // insert
      .mockResolvedValueOnce({ rows: [] }); // credential_exposure delete/insert

    const res = await request(app).post('/servers/srv-1/resources').send({ uri_template: 'postgres://dbuser:sup3rSecret@db.internal:5432/prod' });
    expect(res.status).toBe(201);
    expect(res.body.credential_exposure_detected).toBe(true);

    const insertArgs = pool.query.mock.calls[0][1];
    expect(insertArgs.join(' ')).not.toContain('sup3rSecret');

    const findingsInsertCall = pool.query.mock.calls.find(c => c[0].includes('mcp_credential_exposure'));
    expect(findingsInsertCall).toBeTruthy();
    expect(findingsInsertCall[0]).toContain('resource_uri');
    expect(governanceClient.evaluateServer).toHaveBeenCalledWith('srv-1');
  });
});

describe('PUT /resources/:id', () => {
  it('updates governance fields', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'r1', sensitivity: 'confidential' }] });
    const res = await request(app).put('/resources/r1').send({ sensitivity: 'confidential' });
    expect(res.status).toBe(200);
    expect(res.body.sensitivity).toBe('confidential');
  });

  it('returns 404 for an unknown resource', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).put('/resources/unknown').send({ sensitivity: 'public' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /resources/:id', () => {
  it('deletes a resource', async () => {
    pool.query.mockResolvedValueOnce({ rowCount: 1 });
    const res = await request(app).delete('/resources/r1');
    expect(res.status).toBe(204);
  });

  it('returns 404 for an unknown resource', async () => {
    pool.query.mockResolvedValueOnce({ rowCount: 0 });
    const res = await request(app).delete('/resources/unknown');
    expect(res.status).toBe(404);
  });
});
