import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));

import pool from '../db.js';
import riskHistory from '../src/lib/risk-history.js';

const riskScore = { risk_score: 42, risk_level: 'MEDIUM', dimensions: {} };

beforeEach(() => vi.clearAllMocks());

describe('risk-history.snapshotRiskScore', () => {
  it('skips inserting when the workflow definition hash is unchanged', async () => {
    // metadata-extractor.js stamps discoveredAt fresh on every extraction —
    // simulate two calls a moment apart with otherwise-identical metadata.
    const metadataA = { id: 'wf-1', nodes: [], piiExposure: { risks: [] }, discoveredAt: '2026-01-01T00:00:00Z' };
    const metadataB = { id: 'wf-1', nodes: [], piiExposure: { risks: [] }, discoveredAt: '2026-01-01T00:00:05Z' };

    pool.query
      .mockResolvedValueOnce({ rows: [] })   // no prior history row
      .mockResolvedValueOnce({ rows: [{}] }); // insert
    const first = await riskHistory.snapshotRiskScore({ workflowId: 'wf-1', platform: 'n8n', riskScore, metadata: metadataA });
    expect(first).not.toBeNull();
    const insertedHash = pool.query.mock.calls[1][1][7]; // workflow_definition_hash param

    pool.query.mockResolvedValueOnce({ rows: [{ workflow_definition_hash: insertedHash }] });
    const second = await riskHistory.snapshotRiskScore({ workflowId: 'wf-1', platform: 'n8n', riskScore, metadata: metadataB });
    expect(second).toBeNull();
    expect(pool.query).toHaveBeenCalledTimes(3); // 2 SELECTs + 1 INSERT total (no 2nd INSERT)
  });

  it('inserts a new row when the metadata actually changes', async () => {
    const metadataA = { id: 'wf-1', nodes: [], piiExposure: { risks: [] }, discoveredAt: '2026-01-01T00:00:00Z' };
    const metadataB = { id: 'wf-1', nodes: [{ node_id: 'n1' }], piiExposure: { risks: [] }, discoveredAt: '2026-01-01T00:00:05Z' };

    pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{}] });
    await riskHistory.snapshotRiskScore({ workflowId: 'wf-1', platform: 'n8n', riskScore, metadata: metadataA });
    const insertedHash = pool.query.mock.calls[1][1][7];

    pool.query.mockResolvedValueOnce({ rows: [{ workflow_definition_hash: insertedHash }] });
    pool.query.mockResolvedValueOnce({ rows: [{}] });
    const second = await riskHistory.snapshotRiskScore({ workflowId: 'wf-1', platform: 'n8n', riskScore, metadata: metadataB });
    expect(second).not.toBeNull();
  });
});
