import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveWorkflow } from '../src/discover/n8n-workflow.js';

const ORIGINAL_FETCH = global.fetch;
afterEach(() => { global.fetch = ORIGINAL_FETCH; });

describe('resolveWorkflow', () => {
  it('returns the workflow directly when GET /workflows/:id succeeds (already tracked)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, json: () => Promise.resolve({ id: 'wf-1', name: 'My Workflow' }),
    });

    const result = await resolveWorkflow({ baseUrl: 'https://ioa.example.com', token: 'jwt', target: 'wf-1' });

    expect(result).toEqual({ workflow: { id: 'wf-1', name: 'My Workflow' }, registered: 'already_tracked' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('falls back to matching by exact name (case-insensitive) in the tracked list', async () => {
    let call = 0;
    global.fetch = vi.fn(() => {
      call++;
      if (call === 1) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: 'not found' }) });
      if (call === 2) return Promise.resolve({ ok: true, json: () => Promise.resolve([{ id: 'wf-2', name: 'Report Delivery' }]) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'wf-2', name: 'Report Delivery', risk_score: 40 }) });
    });

    const result = await resolveWorkflow({ baseUrl: 'https://ioa.example.com', token: 'jwt', target: 'report delivery' });

    expect(result).toEqual({ workflow: { id: 'wf-2', name: 'Report Delivery', risk_score: 40 }, registered: 'already_tracked' });
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it('imports the target as an n8n_id when not found by id or name', async () => {
    let call = 0;
    global.fetch = vi.fn(() => {
      call++;
      if (call === 1) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: 'not found' }) });
      if (call === 2) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) }); // nothing tracked
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'wf-new', name: 'Freshly Imported' }) });
    });

    const result = await resolveWorkflow({ baseUrl: 'https://ioa.example.com', token: 'jwt', target: 'n8nWorkflowId123' });

    expect(result).toEqual({ workflow: { id: 'wf-new', name: 'Freshly Imported' }, registered: 'imported' });
    const [importUrl, importOpts] = global.fetch.mock.calls[2];
    expect(importUrl).toContain('/workflows/import');
    expect(JSON.parse(importOpts.body)).toEqual({ n8n_id: 'n8nWorkflowId123' });
  });
});
