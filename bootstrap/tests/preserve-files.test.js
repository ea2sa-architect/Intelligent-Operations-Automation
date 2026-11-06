// Epic 1, Feature 1.4 — regression test proving the bootstrap generator
// respects preserveFiles. This is the exact class of bug that clobbered
// workflow-governance-service's and mcp-governance-service's hand-authored
// index.js/package.json three times during the MCP Governance build — this
// test exists so a future change to service-generator.js can't reintroduce it
// silently. Uses Node's built-in test runner (node --test) — no new
// dependency needed, matching the project's existing minimal-dependency stance.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import ServiceGenerator from '../generators/service-generator.js';

const HAND_AUTHORED_INDEX = '// HAND-AUTHORED — custom router mounts, do not overwrite\nexport default {};\n';
const HAND_AUTHORED_PKG = '{\n  "name": "hand-authored-marker"\n}\n';

async function makeTempRoot() {
  return mkdtemp(join(tmpdir(), 'ioa-bootstrap-test-'));
}

function makeConfig(preserveFiles) {
  return {
    nodeVersion: '20',
    services: [{
      name: 'test-service',
      description: 'Test service',
      port: 9999,
      schema: 'test_schema',
      preserveFiles,
    }],
  };
}

test('preserveFiles protects index.js and package.json from regeneration', async () => {
  const root = await makeTempRoot();
  try {
    const svcDir = join(root, 'services', 'test-service');
    await mkdir(svcDir, { recursive: true });
    await writeFile(join(svcDir, 'index.js'), HAND_AUTHORED_INDEX);
    await writeFile(join(svcDir, 'package.json'), HAND_AUTHORED_PKG);

    const generator = new ServiceGenerator(makeConfig(['index.js', 'package.json']), root);
    await generator.generate();

    assert.equal(await readFile(join(svcDir, 'index.js'), 'utf8'), HAND_AUTHORED_INDEX);
    assert.equal(await readFile(join(svcDir, 'package.json'), 'utf8'), HAND_AUTHORED_PKG);

    // Dockerfile and db.js are NOT in preserveFiles — they must still be generated
    const dockerfile = await readFile(join(svcDir, 'Dockerfile'), 'utf8');
    const dbFile = await readFile(join(svcDir, 'db.js'), 'utf8');
    assert.match(dockerfile, /EXPOSE 9999/);
    assert.match(dbFile, /test_schema/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('without preserveFiles, all four generated files are overwritten (control case)', async () => {
  const root = await makeTempRoot();
  try {
    const svcDir = join(root, 'services', 'test-service');
    await mkdir(svcDir, { recursive: true });
    await writeFile(join(svcDir, 'index.js'), HAND_AUTHORED_INDEX);
    await writeFile(join(svcDir, 'package.json'), HAND_AUTHORED_PKG);

    const generator = new ServiceGenerator(makeConfig([]), root);
    await generator.generate();

    const indexAfter = await readFile(join(svcDir, 'index.js'), 'utf8');
    const pkgAfter = await readFile(join(svcDir, 'package.json'), 'utf8');
    assert.notEqual(indexAfter, HAND_AUTHORED_INDEX);
    assert.notEqual(pkgAfter, HAND_AUTHORED_PKG);
    assert.match(indexAfter, /PORT = process\.env\.PORT \|\| 9999/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('preserveFiles defaulting to undefined behaves the same as an empty list', async () => {
  const root = await makeTempRoot();
  try {
    const svcDir = join(root, 'services', 'test-service');
    await mkdir(svcDir, { recursive: true });
    await writeFile(join(svcDir, 'index.js'), HAND_AUTHORED_INDEX);

    const config = makeConfig(undefined);
    const generator = new ServiceGenerator(config, root);
    await generator.generate();

    const indexAfter = await readFile(join(svcDir, 'index.js'), 'utf8');
    assert.notEqual(indexAfter, HAND_AUTHORED_INDEX);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
