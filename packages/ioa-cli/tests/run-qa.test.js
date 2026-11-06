import { describe, it, expect, vi, afterEach } from 'vitest';
import { runQa } from '../src/pipeline/run-qa.js';

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

describe('runQa', () => {
  it('composes assess\'s sections plus the execution tier into one result', async () => {
    mockByUrl([
      [/\/workflows\/wf-1$/, { ok: true, json: () => Promise.resolve({ id: 'wf-1', name: 'My Workflow', mcp_references: [] }) }],
      ['/violations/evaluate', { ok: true, json: () => Promise.resolve({}) }],
      ['/policy-bindings', { ok: true, json: () => Promise.resolve({ policies: [] }) }],
      ['/violations?', { ok: true, json: () => Promise.resolve([]) }],
      ['/anomaly/baselines/wf-1', { ok: false, status: 404, json: () => Promise.resolve({ error: 'none' }) }],
      ['/execution-profile', { ok: false, status: 404, json: () => Promise.resolve({ error: 'none' }) }],
    ]);

    const result = await runQa({ baseUrl: 'https://ioa.example.com', token: 'jwt', target: 'wf-1' });

    expect(result.target.name).toBe('My Workflow');
    expect(result.anomalies.status).toBe('no_baseline');
    expect(result.attack_paths).toEqual([]);
    expect(result.execution.status).toBe('not_eligible');
  });
});
