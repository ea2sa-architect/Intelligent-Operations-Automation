import { describe, it, expect, vi, afterEach } from 'vitest';
import { runThreatModel } from '../src/pipeline/run-threat-model.js';

const ORIGINAL_FETCH = global.fetch;
afterEach(() => { global.fetch = ORIGINAL_FETCH; });

function mockByUrl(map) {
  global.fetch = vi.fn((url) => {
    for (const [pattern, response] of map) {
      if (typeof pattern === 'string' ? url.includes(pattern) : pattern.test(url)) return Promise.resolve(response);
    }
    throw new Error(`No mock for ${url}`);
  });
}

describe('runThreatModel', () => {
  it('composes violations/coverage, anomalies, attack-paths, and exposure into one result', async () => {
    mockByUrl([
      [/\/workflows\/wf-1$/, { ok: true, json: () => Promise.resolve({
        id: 'wf-1', name: 'My Workflow', mcp_references: [],
        pii_exposure: [{ pii_type: 'email', masked: false, encrypted: false }],
        secret_exposure: [],
        nodes: [{ node_name: 'Run Code', risk_factors: ['arbitrary_code_execution'] }],
      }) }],
      ['/violations/evaluate', { ok: true, json: () => Promise.resolve({}) }],
      ['/policy-bindings', { ok: true, json: () => Promise.resolve({ policies: [] }) }],
      ['/violations?', { ok: true, json: () => Promise.resolve([]) }],
      ['/anomaly/baselines/wf-1', { ok: false, status: 404, json: () => Promise.resolve({ error: 'none' }) }],
    ]);

    const result = await runThreatModel({ baseUrl: 'https://ioa.example.com', token: 'jwt', target: 'wf-1' });

    expect(result.target.name).toBe('My Workflow');
    expect(result.anomalies.status).toBe('no_baseline');
    expect(result.attack_paths).toEqual([]);
    expect(result.exposure).toEqual({
      pii_types: ['email'],
      unmasked_pii_count: 1,
      unrotated_secrets_count: 0,
      nodes_with_risk_factors: [{ node_name: 'Run Code', risk_factors: ['arbitrary_code_execution'] }],
    });
  });
});
