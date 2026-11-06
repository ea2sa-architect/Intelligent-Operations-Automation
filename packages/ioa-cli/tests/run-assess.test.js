import { describe, it, expect, vi, afterEach } from 'vitest';
import { runAssess } from '../src/pipeline/run-assess.js';

const ORIGINAL_FETCH = global.fetch;
afterEach(() => { global.fetch = ORIGINAL_FETCH; });

function mockByUrl(map) {
  global.fetch = vi.fn((url, opts) => {
    for (const [pattern, response] of map) {
      if (typeof pattern === 'string' ? url.includes(pattern) : pattern.test(url)) {
        return Promise.resolve(response);
      }
    }
    throw new Error(`No mock for ${opts?.method ?? 'GET'} ${url}`);
  });
}

const WORKFLOW = {
  id: 'wf-1', name: 'My Workflow',
  mcp_references: [{ mcp_server_id: 'srv-1' }, { mcp_server_id: 'srv-2' }, { mcp_server_id: null }, { mcp_server_id: 'srv-1' }],
};

describe('runAssess', () => {
  it('reports no_baseline (not an empty-alerts false-clean) when no baseline has ever been computed', async () => {
    mockByUrl([
      [/\/workflows\/wf-1$/, { ok: true, json: () => Promise.resolve(WORKFLOW) }],
      ['/violations/evaluate', { ok: true, json: () => Promise.resolve({}) }],
      ['/policy-bindings', { ok: true, json: () => Promise.resolve({ policies: [] }) }],
      ['/violations?', { ok: true, json: () => Promise.resolve([]) }],
      ['/anomaly/baselines/wf-1', { ok: false, status: 404, json: () => Promise.resolve({ error: 'No baseline for this workflow' }) }],
      ['/attack-paths/srv-1', { ok: false, status: 404, json: () => Promise.resolve({ error: 'not computed' }) }],
      ['/attack-paths/srv-2', { ok: true, json: () => Promise.resolve({ mcp_server_id: 'srv-2', server_name: 'crm-mcp', risk_score: 42 }) }],
    ]);

    const result = await runAssess({ baseUrl: 'https://ioa.example.com', token: 'jwt', target: 'wf-1' });

    expect(result.anomalies).toEqual({ status: 'no_baseline', alerts: [] });
    // dedupes srv-1, drops the null reference, and looks up exactly the 2 distinct servers
    expect(result.attack_paths).toEqual([
      { mcp_server_id: 'srv-1', status: 'not_computed' },
      { mcp_server_id: 'srv-2', server_name: 'crm-mcp', risk_score: 42 },
    ]);
  });

  it('fetches open alerts once a baseline exists', async () => {
    mockByUrl([
      [/\/workflows\/wf-1$/, { ok: true, json: () => Promise.resolve({ ...WORKFLOW, mcp_references: [] }) }],
      ['/violations/evaluate', { ok: true, json: () => Promise.resolve({}) }],
      ['/policy-bindings', { ok: true, json: () => Promise.resolve({ policies: [] }) }],
      ['/violations?', { ok: true, json: () => Promise.resolve([]) }],
      ['/anomaly/baselines/wf-1', { ok: true, json: () => Promise.resolve({ workflow_id: 'wf-1', computed_at: new Date().toISOString() }) }],
      ['/anomaly/alerts', { ok: true, json: () => Promise.resolve([{ id: 'a-1', alert_type: 'unexpected_tool' }]) }],
    ]);

    const result = await runAssess({ baseUrl: 'https://ioa.example.com', token: 'jwt', target: 'wf-1' });

    expect(result.anomalies.status).toBe('ok');
    expect(result.anomalies.alerts).toHaveLength(1);
    expect(result.attack_paths).toEqual([]);
  });

  it('propagates a real (non-404) error instead of swallowing it as "not computed"', async () => {
    mockByUrl([
      [/\/workflows\/wf-1$/, { ok: true, json: () => Promise.resolve({ ...WORKFLOW, mcp_references: [] }) }],
      ['/violations/evaluate', { ok: true, json: () => Promise.resolve({}) }],
      ['/policy-bindings', { ok: true, json: () => Promise.resolve({ policies: [] }) }],
      ['/violations?', { ok: true, json: () => Promise.resolve([]) }],
      ['/anomaly/baselines/wf-1', { ok: false, status: 500, json: () => Promise.resolve({ error: 'db unreachable' }) }],
    ]);

    await expect(runAssess({ baseUrl: 'https://ioa.example.com', token: 'jwt', target: 'wf-1' }))
      .rejects.toThrow(/db unreachable/);
  });
});
