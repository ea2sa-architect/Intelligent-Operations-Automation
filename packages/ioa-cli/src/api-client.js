// Every call goes through Kong's public /api/* prefix, matching CLAUDE.md's
// routing table — same convention discovery-agent's api-client.js already
// established: exchange the long-lived IOA_API_KEY once for a short-lived
// JWT, then send that as a Bearer token on every subsequent call.

export async function exchangeApiKey(baseUrl, apiKey) {
  const res = await fetch(`${baseUrl}/api/auth/api-keys/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Failed to exchange API key (${res.status}): ${body.error ?? res.statusText}`);
  }
  return res.json(); // { token, scopes, expires_in }
}

async function request(method, baseUrl, token, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(`${method} ${path} failed (${res.status}): ${errBody.error ?? res.statusText}`);
  }
  return res.json();
}

export const apiGet   = (baseUrl, token, path)       => request('GET',   baseUrl, token, path);
export const apiPost  = (baseUrl, token, path, body) => request('POST',  baseUrl, token, path, body ?? {});
export const apiPatch = (baseUrl, token, path, body) => request('PATCH', baseUrl, token, path, body ?? {});
