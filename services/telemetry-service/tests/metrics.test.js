import { vi, describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
// Route tests exercise business logic, not auth — require-auth.js has its
// own dedicated conformance suite (tests/require-auth.test.js).
vi.mock('../src/lib/require-auth.js', () => ({ default: (req, _res, next) => next(), requirePermission: () => (_req, _res, next) => next() }));
import pool from '../db.js';
import app from '../index.js';

const POINT = {
  time: '2026-05-11T00:00:00Z',
  service_name: 'governance-service',
  metric_name: 'request_count',
  value: 42,
  labels_json: {},
};

beforeEach(() => vi.clearAllMocks());

describe('POST /metrics', () => {
  it('ingests a single metric', async () => {
    pool.query.mockResolvedValueOnce({});
    const res = await request(app).post('/metrics').send(POINT);
    expect(res.status).toBe(202);
    expect(res.body.ingested).toBe(1);
  });

  it('ingests a batch of metrics', async () => {
    pool.query.mockResolvedValueOnce({});
    const res = await request(app)
      .post('/metrics')
      .send([POINT, { ...POINT, metric_name: 'error_count', value: 0 }]);
    expect(res.status).toBe(202);
    expect(res.body.ingested).toBe(2);
  });

  it('returns 400 when service_name is missing', async () => {
    const res = await request(app)
      .post('/metrics')
      .send({ metric_name: 'cpu', value: 80 });
    expect(res.status).toBe(400);
  });

  it('returns 400 when value is missing', async () => {
    const res = await request(app)
      .post('/metrics')
      .send({ service_name: 'governance-service', metric_name: 'cpu' });
    expect(res.status).toBe(400);
  });

  it('returns 500 on DB error', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).post('/metrics').send(POINT);
    expect(res.status).toBe(500);
  });

  // EP-102-S1/S2
  it('stores an explicit per-item correlation_id', async () => {
    pool.query.mockResolvedValueOnce({});
    const id = '550e8400-e29b-41d4-a716-446655440000';
    await request(app).post('/metrics').send({ ...POINT, correlation_id: id });
    const params = pool.query.mock.calls[0][1];
    expect(params).toContain(id);
  });

  it('defaults correlation_id to the request-level id from the x-correlation-id header when not given per item', async () => {
    pool.query.mockResolvedValueOnce({});
    const id = '550e8400-e29b-41d4-a716-446655440000';
    await request(app).post('/metrics').set('x-correlation-id', id).send(POINT);
    const params = pool.query.mock.calls[0][1];
    expect(params).toContain(id);
  });

  it('echoes the assigned correlation id back on the response header', async () => {
    pool.query.mockResolvedValueOnce({});
    const res = await request(app).post('/metrics').send(POINT);
    expect(res.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/i);
  });
});

describe('GET /metrics', () => {
  it('returns time-series data', async () => {
    pool.query.mockResolvedValueOnce({ rows: [POINT] });
    const res = await request(app).get('/metrics?from=2026-05-01T00:00:00Z');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('filters by service_name and metric_name', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await request(app).get('/metrics?service_name=governance-service&metric_name=cpu');
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toContain('service_name');
    expect(sql).toContain('metric_name');
  });

  it('caps limit at 5000', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await request(app).get('/metrics?limit=99999');
    const params = pool.query.mock.calls[0][1];
    expect(params[params.length - 1]).toBe(5000);
  });

  // Epic 6, Feature 6.1 — MCP invocation telemetry needs to be queryable by
  // fields inside labels_json (correlation_id, server_id, tool_id, client_id,
  // workflow_id), supported generically via ?label_<key>=<value>.
  it('filters by a label_ query param against labels_json', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await request(app).get('/metrics?label_correlation_id=abc-123');
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain("labels_json->>$");
    expect(params).toContain('correlation_id');
    expect(params).toContain('abc-123');
  });

  it('supports multiple label_ filters combined', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await request(app).get('/metrics?label_server_id=srv-1&label_tool_id=tool-1');
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql.match(/labels_json->>\$/g)).toHaveLength(2);
    expect(params).toEqual(expect.arrayContaining(['server_id', 'srv-1', 'tool_id', 'tool-1']));
  });

  it('ignores unrelated query params that do not start with label_', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await request(app).get('/metrics?foo=bar');
    const sql = pool.query.mock.calls[0][0];
    expect(sql).not.toContain('labels_json->>$');
  });

  // EP-102-S2 — correlation_id is a first-class column, filterable directly
  // (not only via the generic ?label_correlation_id= mechanism).
  it('filters by the correlation_id column directly', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const id = '550e8400-e29b-41d4-a716-446655440000';
    await request(app).get(`/metrics?correlation_id=${id}`);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('correlation_id = $');
    expect(params).toContain(id);
  });
});

describe('GET /metrics/correlation/:correlation_id', () => {
  it('returns the full chain in chronological order', async () => {
    const id = '550e8400-e29b-41d4-a716-446655440000';
    const chain = [
      { time: '2026-05-11T00:00:00Z', service_name: 'workflow:wf-1', metric_name: 'execution_status', value: 1, labels_json: {}, correlation_id: id },
      { time: '2026-05-11T00:00:05Z', service_name: 'mcp_tool:tool-1', metric_name: 'mcp_tool_invocation', value: 1, labels_json: {}, correlation_id: id },
    ];
    pool.query.mockResolvedValueOnce({ rows: chain });
    const res = await request(app).get(`/metrics/correlation/${id}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('ORDER BY time ASC');
    expect(params).toEqual([id]);
  });
});

describe('GET /metrics/summary', () => {
  it('returns aggregated summary', async () => {
    const summary = [{ service_name: 'governance-service', metric_name: 'cpu', avg: '45.0', min: '10.0', max: '90.0', samples: '100' }];
    pool.query.mockResolvedValueOnce({ rows: summary });
    const res = await request(app).get('/metrics/summary');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].service_name).toBe('governance-service');
  });

  it('filters summary by time range', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await request(app).get('/metrics/summary?from=2026-05-01T00:00:00Z&to=2026-05-12T00:00:00Z');
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toContain('time >=');
    expect(sql).toContain('time <=');
  });
});
