import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../src/lib/require-auth.js', () => ({ default: (req, _res, next) => next(), requirePermission: () => (_req, _res, next) => next() }));
vi.mock('../src/lib/lineage-builder.js', () => ({
  buildFromCorrelationChain: vi.fn(),
  ingestEvent: vi.fn(),
}));

import pool from '../db.js';
import { buildFromCorrelationChain, ingestEvent } from '../src/lib/lineage-builder.js';
import app from '../index.js';

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => { vi.clearAllMocks(); process.env.N8N_BASE_URL = 'https://ea2sa.app.n8n.cloud/api/v1'; });
afterEach(() => { process.env = { ...ORIGINAL_ENV }; });

const MODEL_NODE_WITH_N8N = {
  id: 'node-1', correlation_id: 'corr-1', node_type: 'model', node_id: 'good-model',
  node_name: 'good-model', service_name: 'ai-inference-service', data_classification: 'pii',
  is_external: true, data_region: null,
  metadata_json: {
    metric_name: 'model_inference', workflow_id: 'n8n-wf-1',
    n8n_execution_id: 'exec-4821', n8n_node_name: 'OpenAI — Summarize Invoice',
  },
  created_at: '2026-10-09T00:00:00Z',
};
const PLAIN_NODE = {
  id: 'node-2', correlation_id: 'corr-1', node_type: 'workflow', node_id: 'wf-1',
  node_name: 'Invoice Review', service_name: 'workflow-governance-service', data_classification: 'internal',
  is_external: false, data_region: null, metadata_json: { metric_name: 'workflow_start' },
  created_at: '2026-10-09T00:00:00Z',
};
const WORKFLOW_ROW = { id: 'n8n-wf-1', n8n_id: 'n8n-wf-1', name: 'Invoice Review' };

describe('GET /lineage/:correlation_id — n8n execution linkage', () => {
  it('enriches a node carrying n8n_execution_id with a workflow name and deep link', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [MODEL_NODE_WITH_N8N, PLAIN_NODE] }) // nodes
      .mockResolvedValueOnce({ rows: [] })                                // edges
      .mockResolvedValueOnce({ rows: [WORKFLOW_ROW] });                   // workflow lookup

    const res = await request(app).get('/lineage/corr-1');
    expect(res.status).toBe(200);

    const enriched = res.body.nodes.find(n => n.id === 'node-1');
    expect(enriched.n8n).toEqual({
      workflow_id: 'n8n-wf-1',
      workflow_name: 'Invoice Review',
      execution_id: 'exec-4821',
      node_name: 'OpenAI — Summarize Invoice',
      execution_url: 'https://ea2sa.app.n8n.cloud/workflow/n8n-wf-1/executions/exec-4821',
    });
  });

  it('sets n8n: null for a node with no n8n_execution_id, and skips the workflow lookup entirely', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [PLAIN_NODE] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/lineage/corr-1');
    expect(res.status).toBe(200);
    expect(res.body.nodes[0].n8n).toBeNull();
    // Only the two calls above (nodes, edges) — no workflow lookup query fired.
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  it('returns 404 when no lineage nodes exist for the correlation id', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/lineage/does-not-exist');
    expect(res.status).toBe(404);
  });
});

describe('GET /lineage/', () => {
  it('lists chains with aggregate counts', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ correlation_id: 'corr-1', node_count: 2, external_count: 1 }] });
    const res = await request(app).get('/lineage/');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});

describe('POST /lineage/build', () => {
  it('requires correlation_id', async () => {
    const res = await request(app).post('/lineage/build').send({});
    expect(res.status).toBe(400);
  });

  it('rebuilds the chain', async () => {
    buildFromCorrelationChain.mockResolvedValueOnce({ nodes: [], edges: [] });
    const res = await request(app).post('/lineage/build').send({ correlation_id: 'corr-1' });
    expect(res.status).toBe(200);
    expect(buildFromCorrelationChain).toHaveBeenCalledWith('corr-1');
  });
});

describe('POST /lineage/ingest', () => {
  it('requires correlation_id and service_name', async () => {
    const res = await request(app).post('/lineage/ingest').send({});
    expect(res.status).toBe(400);
  });

  it('ingests the event', async () => {
    ingestEvent.mockResolvedValueOnce(undefined);
    const res = await request(app).post('/lineage/ingest').send({ correlation_id: 'corr-1', service_name: 'ai-inference-service' });
    expect(res.status).toBe(202);
  });
});

describe('GET /lineage/violations', () => {
  it('lists lineage violations', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'v-1', message: 'External processor detected' }] });
    const res = await request(app).get('/lineage/violations');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});
