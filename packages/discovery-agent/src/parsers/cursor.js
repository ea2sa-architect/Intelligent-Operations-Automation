// EP-306-S3 — Cursor. Same mcpServers schema as Claude Desktop/Cline. Unlike
// those two, the config path needs no per-OS branching: ~/.cursor/mcp.json
// on macOS/Linux and %USERPROFILE%\.cursor\mcp.json on Windows both resolve
// via os.homedir(), which Node already maps correctly per platform.
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { parseMcpServersConfig } from '../lib/parse-mcp-servers.js';

export const SOURCE = 'cursor';

export function globalConfigPath() {
  return join(homedir(), '.cursor', 'mcp.json');
}

// Project-level config only applies to the current project — relevant when
// this agent runs from inside a repo checkout (CI, or a developer's cwd),
// same reasoning as vscode.js's workspaceConfigPath.
export function projectConfigPath(cwd = process.cwd()) {
  return join(cwd, '.cursor', 'mcp.json');
}

export function parseConfig(raw, sourcePath) {
  return parseMcpServersConfig(raw, sourcePath, SOURCE);
}

export function scan() {
  const results = [];
  for (const path of [globalConfigPath(), projectConfigPath()]) {
    if (!existsSync(path)) continue;
    results.push(...parseConfig(readFileSync(path, 'utf8'), path));
  }
  return results;
}
