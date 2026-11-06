import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { exchangeApiKey, importDiscovered } from '../src/api-client.js';

const ORIGINAL_FETCH = global.fetch;
afterEach(() => { global.fetch = ORIGINAL_FETCH; });

describe('exchangeApiKey', () => {
  it('posts the raw key to /api/auth/api-keys/exchange and returns the token', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token: 'jwt-here', scopes: ['mcp:register'], expires_in: 900 }),
    });

    const result = await exchangeApiKey('https://ioa.example.com', 'ioak_rawkey');
    expect(global.fetch).toHaveBeenCalledWith('https://ioa.example.com/api/auth/api-keys/exchange', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ api_key: 'ioak_rawkey' }),
    }));
    expect(result).toEqual({ token: 'jwt-here', scopes: ['mcp:register'], expires_in: 900 });
  });

  it('throws a descriptive error on a non-ok response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 401, statusText: 'Unauthorized',
      json: () => Promise.resolve({ error: 'Invalid or revoked API key' }),
    });

    await expect(exchangeApiKey('https://ioa.example.com', 'bad-key')).rejects.toThrow(/Invalid or revoked API key/);
  });
});

describe('importDiscovered', () => {
  it('posts discovered servers with the Bearer token and returns the result summary', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ created: 2, refreshed: 0, already_tracked: 1, skipped: [] }),
    });

    const discovered = [{ name: 's1', command: 'npx' }];
    const result = await importDiscovered('https://ioa.example.com', 'jwt-here', discovered);

    expect(global.fetch).toHaveBeenCalledWith('https://ioa.example.com/api/mcp-governance/servers/discovery-import', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer jwt-here' }),
      body: JSON.stringify({ discovered }),
    }));
    expect(result).toEqual({ created: 2, refreshed: 0, already_tracked: 1, skipped: [] });
  });

  it('throws a descriptive error on a non-ok response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 403, statusText: 'Forbidden',
      json: () => Promise.resolve({ error: 'Permission required: mcp:register' }),
    });

    await expect(importDiscovered('https://ioa.example.com', 'jwt-here', [])).rejects.toThrow(/mcp:register/);
  });
});
