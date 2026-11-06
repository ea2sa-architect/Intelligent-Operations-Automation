// EP-306-S4 — talks to the IOA platform: exchanges an API key (EP-306-S12)
// for a short-lived JWT, then posts discovered servers to the import
// endpoint. Both calls go through Kong's public prefix (path-stripped, same
// as any other IOA API client) — this agent runs outside the docker
// network entirely, on a developer's machine or in CI.
export async function exchangeApiKey(baseUrl, apiKey) {
  const res = await fetch(`${baseUrl}/api/auth/api-keys/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`API key exchange failed (${res.status}): ${body.error ?? res.statusText}`);
  }
  return res.json(); // { token, scopes, expires_in }
}

export async function importDiscovered(baseUrl, token, discovered) {
  const res = await fetch(`${baseUrl}/api/mcp-governance/servers/discovery-import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ discovered }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Import failed (${res.status}): ${body.error ?? res.statusText}`);
  }
  return res.json(); // { created, refreshed, already_tracked, skipped }
}
