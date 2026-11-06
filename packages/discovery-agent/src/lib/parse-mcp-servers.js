// Shared parsing logic for the "mcpServers" config shape used by both Claude
// Desktop and Cline — Cline was originally named "Claude Dev" (its extension
// id, saoudrizwan.claude-dev, still reflects that) and kept the same config
// format. VS Code's own native mcp.json uses a different "servers" key and
// schema (stdio vs http/sse types) — see parsers/vscode.js for that one.

// Never returns raw env values — only the variable names ("env hints" per
// the story's scope). A discovered server's env block is exactly where a
// real API key or token ends up in a local config; this agent reports
// *what's registered*, not the secrets sitting next to it.
function envHints(env) {
  if (!env || typeof env !== 'object') return [];
  return Object.keys(env).sort();
}

export function parseMcpServersConfig(raw, sourcePath, source) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${sourcePath}: not valid JSON (${err.message})`);
  }

  const servers = parsed?.mcpServers;
  if (!servers || typeof servers !== 'object') return [];

  return Object.entries(servers).map(([name, def]) => ({
    name,
    command: def?.command ?? null,
    args: Array.isArray(def?.args) ? def.args : [],
    url: null,
    env_hints: envHints(def?.env),
    source,
    source_path: sourcePath,
  }));
}
