// EP-306-S2 — VS Code's native MCP support (shipped in v1.102, July 2025),
// not the ".vscode/settings.json" + "extensions/*/package.json" the roadmap
// doc originally guessed — settings.json isn't used for MCP config at all,
// and an extension's own package.json describes the extension's declared
// capabilities, not a user's configured servers. The real config lives in
// mcp.json, workspace-level and/or user-profile-level, under a "servers" key
// (not Claude Desktop/Cline's "mcpServers") — and unlike those two, a server
// entry may be url-based (http/sse transport) instead of command-based
// (stdio transport), so it has no shared shape with parseMcpServersConfig.
import { readFileSync, existsSync } from 'fs';
import { homedir, platform } from 'os';
import { join } from 'path';

export const SOURCE = 'vscode';

export function userConfigPath() {
  const home = homedir();
  switch (platform()) {
    case 'darwin':
      return join(home, 'Library', 'Application Support', 'Code', 'User', 'mcp.json');
    case 'win32':
      return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'Code', 'User', 'mcp.json');
    default: // linux and anything else
      return join(home, '.config', 'Code', 'User', 'mcp.json');
  }
}

// Workspace-level config is relative to wherever the CLI is run from, not a
// single fixed OS path — relevant for the "or via CI" case (EP-306-S1's
// architecture note), where the agent runs from inside a repo checkout.
export function workspaceConfigPath(cwd = process.cwd()) {
  return join(cwd, '.vscode', 'mcp.json');
}

function envHints(env) {
  if (!env || typeof env !== 'object') return [];
  return Object.keys(env).sort();
}

export function parseConfig(raw, sourcePath) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`${sourcePath}: not valid JSON (${err.message})`);
  }

  const servers = parsed?.servers;
  if (!servers || typeof servers !== 'object') return [];

  return Object.entries(servers).map(([name, def]) => ({
    name,
    command: def?.command ?? null,
    args: Array.isArray(def?.args) ? def.args : [],
    url: def?.url ?? null,
    env_hints: envHints(def?.env),
    source: SOURCE,
    source_path: sourcePath,
  }));
}

export function scan() {
  const results = [];
  for (const path of [userConfigPath(), workspaceConfigPath()]) {
    if (!existsSync(path)) continue;
    results.push(...parseConfig(readFileSync(path, 'utf8'), path));
  }
  return results;
}
