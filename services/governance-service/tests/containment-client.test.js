import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import containmentClient from '../src/lib/containment-client.js';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  global.fetch = vi.fn();
  process.env.INTERNAL_SERVICE_KEY = 'test-internal-service-key';
});
afterEach(() => { vi.restoreAllMocks(); process.env = { ...ORIGINAL_ENV }; });

describe('applyContainment', () => {
  it('posts to the mcp_server callback with the expected shape', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'srv-1', containment_state: 'suspended' }) });
    const result = await containmentClient.applyContainment('mcp_server', 'srv-1', 'suspended');
    expect(result).toEqual({ id: 'srv-1', containment_state: 'suspended' });

    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain('/servers/srv-1/containment');
    expect(JSON.parse(opts.body)).toEqual({ containment_state: 'suspended' });
    expect(opts.headers['X-Internal-Service-Key']).toBe('test-internal-service-key');
  });

  it('routes mcp_tool to the tools callback', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    await containmentClient.applyContainment('mcp_tool', 'tool-1', 'quarantined');
    expect(global.fetch.mock.calls[0][0]).toContain('/tools/tool-1/containment');
  });

  it('routes workflow to the workflow-governance-service callback', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    await containmentClient.applyContainment('workflow', 'wf-1', 'active');
    expect(global.fetch.mock.calls[0][0]).toContain('/workflows/wf-1/containment');
  });

  // Deliberately NOT fail-soft — this is the kill switch itself.
  it('throws when the callback is unreachable', async () => {
    global.fetch.mockRejectedValueOnce(new Error('connection refused'));
    await expect(containmentClient.applyContainment('mcp_server', 'srv-1', 'suspended')).rejects.toThrow('connection refused');
  });

  it('throws when the callback returns a non-ok response', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 404, text: async () => 'Server not found' });
    await expect(containmentClient.applyContainment('mcp_server', 'srv-1', 'suspended')).rejects.toThrow('404');
  });

  it('throws for an unsupported asset_type without calling fetch', async () => {
    await expect(containmentClient.applyContainment('bogus_type', 'x', 'active')).rejects.toThrow('Unsupported asset_type');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('rollbackTool', () => {
  it('posts to the tools rollback callback', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'tool-1', approval_status: 'pending' }) });
    const result = await containmentClient.rollbackTool('tool-1');
    expect(result).toEqual({ id: 'tool-1', approval_status: 'pending' });
    expect(global.fetch.mock.calls[0][0]).toContain('/tools/tool-1/rollback');
  });

  it('throws when no snapshot exists to roll back to', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 404, text: async () => 'No previous definition snapshot to roll back to' });
    await expect(containmentClient.rollbackTool('tool-1')).rejects.toThrow('404');
  });
});
