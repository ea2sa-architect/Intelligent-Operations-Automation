// EP-306-S2 — Cline (VS Code extension). The roadmap doc's "Claude/Cline
// extensions" phrase refers to one extension, not two: Cline was originally
// named "Claude Dev", and its extension id (saoudrizwan.claude-dev) still
// reflects that. It kept the same mcpServers config shape Claude Desktop
// uses, stored in its own settings file under VS Code's global storage.
import { readFileSync, existsSync } from 'fs';
import { homedir, platform } from 'os';
import { join } from 'path';
import { parseMcpServersConfig } from '../lib/parse-mcp-servers.js';

export const SOURCE = 'vscode_cline';

const EXTENSION_ID = 'saoudrizwan.claude-dev';

export function configPath() {
  const home = homedir();
  const segments = ['Code', 'User', 'globalStorage', EXTENSION_ID, 'settings', 'cline_mcp_settings.json'];
  switch (platform()) {
    case 'darwin':
      return join(home, 'Library', 'Application Support', ...segments);
    case 'win32':
      return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), ...segments);
    default: // linux and anything else
      return join(home, '.config', ...segments);
  }
}

export function parseConfig(raw, sourcePath) {
  return parseMcpServersConfig(raw, sourcePath, SOURCE);
}

export function scan() {
  const path = configPath();
  if (!existsSync(path)) return [];
  return parseConfig(readFileSync(path, 'utf8'), path);
}
