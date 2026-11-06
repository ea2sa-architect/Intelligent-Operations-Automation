import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const services = [
  'governance-service',
  'ai-inference-service',
  'audit-service',
  'escalation-service',
  'telemetry-service',
  'workflow-governance-service',
  'mcp-governance-service',
  'auth-service',
];

let passed = 0;
let failed = 0;

for (const svc of services) {
  const cwd = resolve(root, 'services', svc);
  process.stdout.write(`\n${'─'.repeat(60)}\n▶  ${svc}\n${'─'.repeat(60)}\n`);
  try {
    execSync('npm test', { cwd, stdio: 'inherit' });
    passed++;
  } catch {
    failed++;
  }
}

process.stdout.write(`\n${'─'.repeat(60)}\n▶  bootstrap (preserveFiles regression)\n${'─'.repeat(60)}\n`);
try {
  execSync('node --test bootstrap/tests/preserve-files.test.js', { cwd: root, stdio: 'inherit' });
  passed++;
} catch {
  failed++;
}

console.log(`\n${'═'.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('═'.repeat(60));
if (failed > 0) process.exit(1);
