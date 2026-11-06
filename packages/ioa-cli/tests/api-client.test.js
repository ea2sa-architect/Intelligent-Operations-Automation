import { describe, it, expect, vi, afterEach } from 'vitest';
import { exchangeApiKey, apiGet, apiPost, apiPatch } from '../src/api-client.js';

const ORIGINAL_FETCH = global.fetch;
afterEach(() => { global.fetch = ORIGINAL_FETCH; });

describe('exchangeApiKey', () => {
  it('posts the raw key to /api/auth/api-keys/exchange and returns the token', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token: 'jwt-here', scopes: ['policy:edit'], expires_in: 900 }),
    });

    const result = await exchangeApiKey('https://ioa.example.com', 'ioak_rawkey');
    expect(global.fetch).toHaveBeenCalledWith('https://ioa.example.com/api/auth/api-keys/exchange', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ api_key: 'ioak_rawkey' }),
    }));
    expect(result).toEqual({ token: 'jwt-here', scopes: ['policy:edit'], expires_in: 900 });
  });

  it('throws a descriptive error on a non-ok response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 401, statusText: 'Unauthorized',
      json: () => Promise.resolve({ error: 'Invalid or revoked API key' }),
    });

    await expect(exchangeApiKey('https://ioa.example.com', 'bad-key')).rejects.toThrow(/Invalid or revoked API key/);
  });
});

describe('apiGet', () => {
  it('sends a Bearer token and no body', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ hello: 'world' }) });

    const result = await apiGet('https://ioa.example.com', 'jwt-here', '/api/governance/rule-schemas');

    expect(global.fetch).toHaveBeenCalledWith('https://ioa.example.com/api/governance/rule-schemas', expect.objectContaining({
      method: 'GET',
      headers: expect.objectContaining({ Authorization: 'Bearer jwt-here' }),
    }));
    expect(global.fetch.mock.calls[0][1]).not.toHaveProperty('body');
    expect(result).toEqual({ hello: 'world' });
  });

  it('throws a descriptive error on a non-ok response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 404, statusText: 'Not Found', json: () => Promise.resolve({ error: 'not found' }),
    });
    await expect(apiGet('https://ioa.example.com', 'jwt', '/api/x')).rejects.toThrow(/not found/);
  });
});

describe('apiPost / apiPatch', () => {
  it('apiPost sends the JSON body with a Bearer token', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ id: 'p-1' }) });

    const result = await apiPost('https://ioa.example.com', 'jwt-here', '/api/governance/policies', { name: 'My Policy' });

    expect(global.fetch).toHaveBeenCalledWith('https://ioa.example.com/api/governance/policies', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer jwt-here' }),
      body: JSON.stringify({ name: 'My Policy' }),
    }));
    expect(result).toEqual({ id: 'p-1' });
  });

  it('apiPatch sends the JSON body with a Bearer token', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ enforcement_mode: 'warn' }) });

    await apiPatch('https://ioa.example.com', 'jwt-here', '/api/governance/policies/p-1/enforcement-mode', { enforcement_mode: 'warn' });

    expect(global.fetch).toHaveBeenCalledWith('https://ioa.example.com/api/governance/policies/p-1/enforcement-mode', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ enforcement_mode: 'warn' }),
    }));
  });
});
