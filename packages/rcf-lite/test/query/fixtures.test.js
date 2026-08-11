// Golden-file tests. Invoke the three verbs against the committed
// dogfood tree at `rcf/` in three formats each and compare stdout to
// the fixture files under `test/query/fixtures/`. Spec §D17 / §3.4.
//
// Nine fixtures total (three verbs x three formats). When the
// underlying tree changes, regenerate the fixtures via `bin/rcf.js`
// and commit them alongside the tree change (§3.4 note).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const bin = resolve(repoRoot, 'bin', 'rcf.js');
const fixturesDir = resolve(here, 'fixtures');

async function runBin(args) {
  const { stdout } = await exec(process.execPath, [bin, ...args], {
    cwd: repoRoot, encoding: 'utf8', env: { ...process.env, CI: '1' },
  });
  return stdout;
}

async function goldenTest(name, args, fixture) {
  const actual = await runBin(args);
  const expected = await readFile(resolve(fixturesDir, fixture), 'utf8');
  assert.equal(
    actual, expected,
    `\nGolden file mismatch for ${name}. Regenerate with:\n  node bin/rcf.js ${args.join(' ')} > test/query/fixtures/${fixture}\n`,
  );
}

test('golden: rcf coverage --format table matches dogfood fixture', async () => {
  await goldenTest('coverage table', ['coverage', '--format', 'table'], 'coverage.table.txt');
});

test('golden: rcf coverage --format json matches dogfood fixture', async () => {
  await goldenTest('coverage json', ['coverage', '--format', 'json'], 'coverage.json');
});

test('golden: rcf coverage --format mermaid matches dogfood fixture', async () => {
  await goldenTest('coverage mermaid', ['coverage', '--format', 'mermaid'], 'coverage.mmd');
});

test('golden: rcf trace REQ-002 --forward --format table matches dogfood fixture', async () => {
  await goldenTest('trace table', ['trace', 'REQ-002', '--forward', '--format', 'table'], 'trace.table.txt');
});

test('golden: rcf trace REQ-002 --forward --format json matches dogfood fixture', async () => {
  await goldenTest('trace json', ['trace', 'REQ-002', '--forward', '--format', 'json'], 'trace.json');
});

test('golden: rcf trace REQ-002 --forward --format mermaid matches dogfood fixture', async () => {
  await goldenTest('trace mermaid', ['trace', 'REQ-002', '--forward', '--format', 'mermaid'], 'trace.mmd');
});

test('golden: rcf impact TAC-001 --format table matches dogfood fixture', async () => {
  await goldenTest('impact table', ['impact', 'TAC-001', '--format', 'table'], 'impact.table.txt');
});

test('golden: rcf impact TAC-001 --format json matches dogfood fixture', async () => {
  await goldenTest('impact json', ['impact', 'TAC-001', '--format', 'json'], 'impact.json');
});

test('golden: rcf impact TAC-001 --format mermaid matches dogfood fixture', async () => {
  await goldenTest('impact mermaid', ['impact', 'TAC-001', '--format', 'mermaid'], 'impact.mmd');
});
