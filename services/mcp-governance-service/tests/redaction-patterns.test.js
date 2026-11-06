import { vi, describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
// Route tests exercise business logic, not auth — require-auth.js has its own dedicated conformance suite (tests/require-auth.test.js).
vi.mock('../src/lib/require-auth.js', () => ({ default: (req, _res, next) => next(), requirePermission: () => (_req, _res, next) => next() }));
import pool from '../db.js';
import app from '../index.js';

beforeEach(() => vi.clearAllMocks());

describe('GET /redaction-patterns', () => {
  it('lists patterns', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'p1', name: 'internal_token', pattern: 'internal-[a-f0-9]{16}', enabled: true }] });
    const res = await request(app).get('/redaction-patterns');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});

describe('POST /redaction-patterns', () => {
  it('creates a pattern', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'p1', name: 'internal_token', pattern: 'internal-[a-f0-9]{16}', enabled: true }] });
    const res = await request(app).post('/redaction-patterns').send({ name: 'internal_token', pattern: 'internal-[a-f0-9]{16}' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('internal_token');
  });

  it('rejects a missing name', async () => {
    const res = await request(app).post('/redaction-patterns').send({ pattern: 'x' });
    expect(res.status).toBe(400);
  });

  it('rejects a missing pattern', async () => {
    const res = await request(app).post('/redaction-patterns').send({ name: 'x' });
    expect(res.status).toBe(400);
  });

  // Epic 6, Feature 6.2 — "without changing application code" also means a
  // bad pattern is rejected at creation, not discovered later at scan time
  it('rejects an invalid regular expression', async () => {
    const res = await request(app).post('/redaction-patterns').send({ name: 'bad', pattern: 'foo-(unterminated' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('not a valid regular expression');
  });

  // EP-101-S3 — GET /redaction-patterns returns name/pattern unfiltered, so
  // a real credential pasted into either field at write time must never be
  // allowed to land in the table.
  it('rejects a pattern field that contains a real credential instead of a regex', async () => {
    const rawKey = 'sk-' + 'a1B2c3D4e5F6g7H8i9J0'.repeat(2);
    const res = await request(app).post('/redaction-patterns').send({ name: 'oops', pattern: rawKey });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('openai_key');
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('rejects a name field that contains a real credential', async () => {
    const rawKey = 'sk-' + 'a1B2c3D4e5F6g7H8i9J0'.repeat(2);
    const res = await request(app).post('/redaction-patterns').send({ name: `leaked: ${rawKey}`, pattern: 'internal-[a-f0-9]{16}' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('openai_key');
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('PATCH /redaction-patterns/:id', () => {
  it('disables a pattern', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'p1', enabled: false }] });
    const res = await request(app).patch('/redaction-patterns/p1').send({ enabled: false });
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
  });

  it('rejects an invalid pattern update', async () => {
    const res = await request(app).patch('/redaction-patterns/p1').send({ pattern: '(unterminated' });
    expect(res.status).toBe(400);
  });

  it('rejects a pattern update that contains a real credential', async () => {
    const rawKey = 'sk-' + 'a1B2c3D4e5F6g7H8i9J0'.repeat(2);
    const res = await request(app).patch('/redaction-patterns/p1').send({ pattern: rawKey });
    expect(res.status).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown pattern', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).patch('/redaction-patterns/unknown').send({ enabled: false });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /redaction-patterns/:id', () => {
  it('deletes a pattern', async () => {
    pool.query.mockResolvedValueOnce({ rowCount: 1 });
    const res = await request(app).delete('/redaction-patterns/p1');
    expect(res.status).toBe(204);
  });

  it('returns 404 for an unknown pattern', async () => {
    pool.query.mockResolvedValueOnce({ rowCount: 0 });
    const res = await request(app).delete('/redaction-patterns/unknown');
    expect(res.status).toBe(404);
  });
});
