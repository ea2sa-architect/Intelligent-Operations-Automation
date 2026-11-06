// EP-306-S1 — scan orchestrator. A registry of parser modules rather than a
// single hardcoded call, so S2 (VS Code) and S3 (Cursor/Windsurf) slot in as
// additional entries here without touching the CLI or this function's shape.
import * as claudeDesktop from './parsers/claude-desktop.js';
import * as cline from './parsers/cline.js';
import * as vscode from './parsers/vscode.js';
import * as cursor from './parsers/cursor.js';
import * as windsurf from './parsers/windsurf.js';
import * as docker from './parsers/docker.js';

const PARSERS = [claudeDesktop, cline, vscode, cursor, windsurf, docker];

// EP-306-S8 — docker.js's scan() is async (shells out to the docker CLI);
// the file-based parsers' scan() is sync. `await`ing a non-promise value
// just resolves immediately, so one async loop handles both without the
// sync parsers needing any change.
export async function runScan() {
  const discovered = [];
  const errors = [];

  for (const parser of PARSERS) {
    try {
      discovered.push(...(await parser.scan()));
    } catch (err) {
      errors.push({ source: parser.SOURCE, message: err.message });
    }
  }

  return { discovered, errors };
}
