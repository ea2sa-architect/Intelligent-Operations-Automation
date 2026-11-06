import { vi, describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
// Route tests exercise business logic, not auth — require-auth.js has its own dedicated conformance suite (tests/require-auth.test.js).
vi.mock('../src/lib/require-auth.js', () => ({ default: (req, _res, next) => next(), requirePermission: () => (_req, _res, next) => next() }));
import pool from '../db.js';
import app from '../index.js';

const INCIDENT = {
  id: 'aaaaaaaa-0000-0000-0000-000000000001',
  rule_id: null,
  title: 'High CPU on governance-service',
  severity: 'high',
  status: 'open',
  context_json: null,
  triggered_at: '2026-05-11T00:00:00Z',
  acknowledged_at: null,
  resolved_at: null,
};

beforeEach(() => vi.clearAllMocks());

describe('GET /incidents', () => {
  it('returns list of incidents', async () => {
    pool.query.mockResolvedValueOnce({ rows: [INCIDENT] });
    const res = await request(app).get('/incidents');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('filters by status', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await request(app).get('/incidents?status=open');
    expect(pool.query.mock.calls[0][0]).toContain('status');
  });

  it('filters by severity', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await request(app).get('/incidents?severity=critical');
    expect(pool.query.mock.calls[0][0]).toContain('severity');
  });
});

describe('POST /incidents', () => {
  it('triggers an incident', async () => {
    pool.query.mockResolvedValueOnce({ rows: [INCIDENT] });
    const res = await request(app)
      .post('/incidents')
      .send({ title: 'High CPU', severity: 'high' });
    expect(res.status).toBe(201);
    expect(res.body.severity).toBe('high');
  });

  it('returns 400 when title is missing', async () => {
    const res = await request(app).post('/incidents').send({ severity: 'high' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when severity is missing', async () => {
    const res = await request(app).post('/incidents').send({ title: 'oops' });
    expect(res.status).toBe(400);
  });
});

describe('GET /incidents/:id', () => {
  it('returns incident with escalation log', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [INCIDENT] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get(`/incidents/${INCIDENT.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(INCIDENT.id);
    expect(res.body.log).toEqual([]);
  });

  it('returns 404 when not found', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/incidents/does-not-exist');
    expect(res.status).toBe(404);
  });
});

describe('PATCH /incidents/:id/status', () => {
  it('acknowledges an open incident', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ status: 'open' }] })
      .mockResolvedValueOnce({ rows: [{ ...INCIDENT, status: 'acknowledged', acknowledged_at: '2026-05-11T01:00:00Z' }] });
    const res = await request(app)
      .patch(`/incidents/${INCIDENT.id}/status`)
      .send({ status: 'acknowledged' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('acknowledged');
  });

  it('resolves an acknowledged incident', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ status: 'acknowledged' }] })
      .mockResolvedValueOnce({ rows: [{ ...INCIDENT, status: 'resolved', resolved_at: '2026-05-11T02:00:00Z' }] });
    const res = await request(app)
      .patch(`/incidents/${INCIDENT.id}/status`)
      .send({ status: 'resolved' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('resolved');
  });

  it('returns 409 for invalid transition', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ status: 'resolved' }] });
    const res = await request(app)
      .patch(`/incidents/${INCIDENT.id}/status`)
      .send({ status: 'acknowledged' });
    expect(res.status).toBe(409);
  });

  it('returns 404 when not found', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .patch('/incidents/does-not-exist/status')
      .send({ status: 'acknowledged' });
    expect(res.status).toBe(404);
  });
});

describe('POST /incidents/:id/log', () => {
  it('logs a notification entry', async () => {
    const entry = { id: 'dddddddd-0000-0000-0000-000000000001', incident_id: INCIDENT.id, channel: 'email', recipient: 'ops@example.com' };
    pool.query.mockResolvedValueOnce({ rows: [entry] });
    const res = await request(app)
      .post(`/incidents/${INCIDENT.id}/log`)
      .send({ channel: 'email', recipient: 'ops@example.com' });
    expect(res.status).toBe(201);
    expect(res.body.channel).toBe('email');
  });

  it('returns 400 when channel is missing', async () => {
    const res = await request(app)
      .post(`/incidents/${INCIDENT.id}/log`)
      .send({ recipient: 'ops@example.com' });
    expect(res.status).toBe(400);
  });
});
