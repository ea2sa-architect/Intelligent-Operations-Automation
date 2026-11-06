// EP-306-S3 — Windsurf. Same mcpServers schema as Claude Desktop/Cline/
// Cursor. Single global config, no project-level variant — os.homedir()
// resolves ~/.codeium/windsurf/mcp_config.json correctly on all 3 platforms
// (macOS/Linux/Windows), same as cursor.js.
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { parseMcpServersConfig } from '../lib/parse-mcp-servers.js';

export const SOURCE = 'windsurf';

export function configPath() {
  return join(homedir(), '.codeium', 'windsurf', 'mcp_config.json');
}

export function parseConfig(raw, sourcePath) {
  return parseMcpServersConfig(raw, sourcePath, SOURCE);
}

export function scan() {
  const path = configPath();
  if (!existsSync(path)) return [];
  return parseConfig(readFileSync(path, 'utf8'), path);
}
