// EP-306-S8 — Docker container scanner. Shells out to the `docker` CLI
// (assumed to be on PATH, same "runs on a developer machine or in CI"
// assumption S1's architecture note makes) rather than talking to the
// Docker socket directly — simpler, and matches how a human would inspect
// their own containers.
//
// Detection here is necessarily heuristic: unlike a database with a
// standard port (Postgres 5432, Redis 6379), there is no MCP-specific
// network port convention. MCP servers primarily communicate over stdio
// (spawned as a subprocess by their client); remote/HTTP/SSE servers use
// whatever port their operator chose. The one verified, concrete signal is
// image naming: Anthropic + Docker publish official reference servers to
// Docker Hub's `mcp/` namespace (e.g. `mcp/filesystem`, `mcp/puppeteer`).
// Beyond that this matches on command/image substrings, same spirit as a
// virus scanner's signature list — real signal, not a protocol-level fact.
import { execFile } from 'child_process';

export const SOURCE = 'docker';

// Not util.promisify(execFile) — execFile's callback is (error, stdout,
// stderr), and Node only resolves that to a clean { stdout, stderr } object
// via an internal util.promisify.custom symbol attached to the real
// function. A test mock of the child_process module won't carry that
// symbol, so promisify(execFile) silently breaks under mocking. This
// wrapper matches the real callback shape explicitly instead.
function execFileAsync(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, options, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve({ stdout, stderr });
    });
  });
}

const IMAGE_PATTERNS = [/^mcp\//i, /mcp[-_]server/i];
const COMMAND_PATTERNS = [/@modelcontextprotocol\/server-/i, /mcp[-_]server/i];

export function looksLikeMcp(image, command) {
  return IMAGE_PATTERNS.some(p => p.test(image)) || COMMAND_PATTERNS.some(p => p.test(command));
}

// Same "keys only, never values" rule every other parser in this package
// follows — a container's real env includes live secrets in plaintext
// (confirmed against this platform's own containers while building this:
// INTERNAL_SERVICE_KEY, API keys, JWT signing keys all show up unredacted
// in `docker inspect`). Entries are "KEY=value" strings; only the key ever
// leaves this function.
function envHints(envList = []) {
  return envList.map(e => e.split('=')[0]).filter(Boolean).sort();
}

async function listContainers() {
  const { stdout } = await execFileAsync('docker', ['ps', '--no-trunc', '--format', '{{json .}}'], { maxBuffer: 10 * 1024 * 1024 });
  return stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}

async function containerEnv(id) {
  try {
    const { stdout } = await execFileAsync('docker', ['inspect', id, '--format', '{{json .Config.Env}}']);
    return JSON.parse(stdout.trim()) ?? [];
  } catch {
    // Container stopped between `ps` and `inspect`, or inspect otherwise
    // failed — still report it from the ps line alone, just without env hints.
    return [];
  }
}

// Docker's reported Command is a display string ("npx -y @mcp/server-x"),
// not a reliably-split argv — quoted args with spaces don't round-trip
// through it safely. Kept whole in `command`, `args` left empty, same
// tradeoff noted in the module comment above.
export async function scan() {
  let containers;
  try {
    containers = await listContainers();
  } catch {
    // Docker not installed, daemon not running, or no permission on the
    // socket — empty result, not an error, same as a missing config file
    // elsewhere in this package. Most CI runners won't have Docker at all.
    return [];
  }

  const results = [];
  for (const c of containers) {
    const image = c.Image ?? '';
    const command = (c.Command ?? '').replace(/^"|"$/g, '');
    if (!looksLikeMcp(image, command)) continue;

    const envList = await containerEnv(c.ID);
    results.push({
      name: c.Names ?? c.ID,
      command,
      args: [],
      url: null,
      env_hints: envHints(envList),
      source: SOURCE,
      source_path: `docker container: ${c.Names ?? c.ID} (image: ${image})`,
    });
  }
  return results;
}
