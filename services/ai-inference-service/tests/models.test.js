import { vi, describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
// Route tests exercise business logic, not auth — require-auth.js has its own dedicated conformance suite (tests/require-auth.test.js).
vi.mock('../src/lib/require-auth.js', () => ({ default: (req, _res, next) => next(), requirePermission: () => (_req, _res, next) => next() }));
import pool from '../db.js';
import app from '../index.js';

const MODEL = {
  id: 'aaaaaaaa-0000-0000-0000-000000000001',
  name: 'gpt-4',
  version: '1.0',
  endpoint: 'https://api.example.com',
  status: 'active',
  metadata_json: null,
  created_at: '2026-05-11T00:00:00Z',
  updated_at: '2026-05-11T00:00:00Z',
};

beforeEach(() => vi.clearAllMocks());

describe('GET /models', () => {
  it('returns list of models', async () => {
    pool.query.mockResolvedValueOnce({ rows: [MODEL] });
    const res = await request(app).get('/models');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('filters by status', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await request(app).get('/models?status=active');
    expect(pool.query.mock.calls[0][0]).toContain('status');
  });
});

describe('POST /models', () => {
  it('registers a model', async () => {
    pool.query.mockResolvedValueOnce({ rows: [MODEL] });
    const res = await request(app).post('/models').send({ name: 'gpt-4', version: '1.0' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('gpt-4');
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app).post('/models').send({ version: '1.0' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when version is missing', async () => {
    const res = await request(app).post('/models').send({ name: 'gpt-4' });
    expect(res.status).toBe(400);
  });
});

describe('GET /models/:id', () => {
  it('returns the model', async () => {
    pool.query.mockResolvedValueOnce({ rows: [MODEL] });
    const res = await request(app).get(`/models/${MODEL.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(MODEL.id);
  });

  it('returns 404 when not found', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/models/does-not-exist');
    expect(res.status).toBe(404);
  });
});

describe('PATCH /models/:id/status', () => {
  it('sets status to active', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ ...MODEL, status: 'active' }] });
    const res = await request(app).patch(`/models/${MODEL.id}/status`).send({ status: 'active' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
  });

  it('sets status to deprecated', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ ...MODEL, status: 'deprecated' }] });
    const res = await request(app).patch(`/models/${MODEL.id}/status`).send({ status: 'deprecated' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('deprecated');
  });

  it('returns 400 for invalid status value', async () => {
    const res = await request(app).patch(`/models/${MODEL.id}/status`).send({ status: 'unknown' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when model not found', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).patch('/models/does-not-exist/status').send({ status: 'active' });
    expect(res.status).toBe(404);
  });
});
