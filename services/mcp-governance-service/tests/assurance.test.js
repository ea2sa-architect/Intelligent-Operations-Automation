import { vi, describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
// Route tests exercise business logic, not auth — require-auth.js has its
// own dedicated conformance suite (tests/require-auth.test.js).
vi.mock('../src/lib/require-auth.js', () => ({ default: (req, _res, next) => next(), requirePermission: () => (_req, _res, next) => next() }));
import pool from '../db.js';
import app from '../index.js';

beforeEach(() => vi.clearAllMocks());

describe('POST /servers/:serverId/assurance-evidence', () => {
  it('submits evidence as collected by default', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1, server_id: 'srv-1', evidence_type: 'config_export', status: 'collected' }] });
    const res = await request(app).post('/servers/srv-1/assurance-evidence').send({ evidence_type: 'config_export' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('collected');
  });

  it('rejects an invalid evidence_type', async () => {
    const res = await request(app).post('/servers/srv-1/assurance-evidence').send({ evidence_type: 'not_a_real_type' });
    expect(res.status).toBe(400);
  });
});

describe('GET /servers/:serverId/assurance-evidence', () => {
  it('lists evidence for a server', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1, evidence_type: 'config_export' }] });
    const res = await request(app).get('/servers/srv-1/assurance-evidence');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  // Epic 6, Feature 6.3 — "expired or stale assurance evidence identified"
  it('filters to stale/expired evidence when ?stale=true', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await request(app).get('/servers/srv-1/assurance-evidence?stale=true');
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toContain("status = 'expired'");
    expect(sql).toContain('expires_at < NOW()');
  });
});

describe('PATCH /assurance-evidence/:id/status', () => {
  it('rejects an invalid status', async () => {
    const res = await request(app).patch('/assurance-evidence/1/status').send({ status: 'bogus' });
    expect(res.status).toBe(400);
  });

  it('requires a rejection_reason when rejecting', async () => {
    const res = await request(app).patch('/assurance-evidence/1/status').send({ status: 'rejected' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('rejection_reason is required');
  });

  it('returns 404 for unknown evidence', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).patch('/assurance-evidence/unknown/status').send({ status: 'validated' });
    expect(res.status).toBe(404);
  });

  it('rejects evidence with a reason recorded', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ server_id: 'srv-1', evidence_type: 'config_export' }] }) // existing lookup
      .mockResolvedValueOnce({ rows: [{ id: 1, status: 'rejected', rejection_reason: 'Export is stale' }] }); // update

    const res = await request(app).patch('/assurance-evidence/1/status').send({ status: 'rejected', rejection_reason: 'Export is stale' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('rejected');
    const updateArgs = pool.query.mock.calls[1][1];
    expect(updateArgs).toContain('Export is stale');
  });

  // Epic 6, Feature 6.4 — validating supersedes the prior validated evidence
  // of the same type on the same server, retained (not deleted) for history
  it('supersedes prior validated evidence of the same type when validating new evidence', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ server_id: 'srv-1', evidence_type: 'config_export' }] }) // existing lookup
      .mockResolvedValueOnce({ rows: [{ id: 2, status: 'validated' }] }) // update to validated
      .mockResolvedValueOnce({ rows: [] }); // supersede old validated rows

    const res = await request(app).patch('/assurance-evidence/2/status').send({ status: 'validated' });
    expect(res.status).toBe(200);

    const supersedeCall = pool.query.mock.calls[2];
    expect(supersedeCall[0]).toContain("SET status = 'superseded'");
    expect(supersedeCall[1]).toEqual(['srv-1', 'config_export', '2']);
  });

  it('does not attempt to supersede anything when rejecting', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ server_id: 'srv-1', evidence_type: 'config_export' }] })
      .mockResolvedValueOnce({ rows: [{ id: 1, status: 'rejected' }] });

    await request(app).patch('/assurance-evidence/1/status').send({ status: 'rejected', rejection_reason: 'x' });
    expect(pool.query).toHaveBeenCalledTimes(2);
  });
});
