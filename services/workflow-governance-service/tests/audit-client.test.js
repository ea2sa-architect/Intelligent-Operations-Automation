import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { logWorkflowsCleared } from '../src/lib/audit-client.js';

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  global.fetch = vi.fn();
  process.env.INTERNAL_SERVICE_KEY = 'test-internal-service-key';
});
afterEach(() => { vi.restoreAllMocks(); process.env = { ...ORIGINAL_ENV }; });

describe('logWorkflowsCleared', () => {
  it('posts a workflow.bulk_delete event with the actor and count', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true });
    await logWorkflowsCleared({ actorId: 'admin-1', count: 42 });

    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain('/events');
    expect(opts.headers['X-Internal-Service-Key']).toBe('test-internal-service-key');

    const body = JSON.parse(opts.body);
    expect(body).toMatchObject({
      event_type: 'workflow.bulk_delete', actor_id: 'admin-1', actor_type: 'user',
      resource_type: 'workflow', resource_id: 'all', action: 'delete', outcome: 'success',
      metadata_json: { count: 42 },
    });
  });

  it('falls back to "unknown" actor when none is given', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true });
    await logWorkflowsCleared({ count: 0 });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.actor_id).toBe('unknown');
  });

  it('does not throw when audit-service is unreachable', async () => {
    global.fetch.mockRejectedValueOnce(new Error('connection refused'));
    await expect(logWorkflowsCleared({ actorId: 'admin-1', count: 1 })).resolves.toBeUndefined();
  });
});
