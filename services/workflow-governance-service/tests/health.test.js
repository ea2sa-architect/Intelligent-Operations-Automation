import { vi, describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../src/lib/cache.js', () => ({ default: { get: vi.fn().mockResolvedValue(null), set: vi.fn(), del: vi.fn(), TTL: { METADATA: 300, RISK: 3600, LIST: 300 } } }));
import pool from '../db.js';
import app from '../index.js';

beforeEach(() => vi.clearAllMocks());

describe('GET /health', () => {
  it('returns ok when db is healthy', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('workflow-governance-service');
  });

  it('returns 503 when db is down', async () => {
    pool.query.mockRejectedValueOnce(new Error('connection refused'));
    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
  });
});
