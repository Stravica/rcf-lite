// B5 CLI regression: the write verbs no longer wedge on a broken tree.
// Mirrors the exact operator-observed failure (E2E matrix 2026-07-06-003,
// cell p2-opus): with a malformed TS-003 on disk, `rcf update` and
// `rcf delete` previously exited 3 for EVERY write - total lock-in.
// Post-write semantics: repair and delete exit 0 (with a [warn] naming
// the pre-existing issues); net-new breakage still exits 3.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { initProject } from '../../src/store/init.js';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, '..', '..', 'bin', 'rcf.js');

async function runBin(cwd, args = []) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [bin, ...args], {
      cwd, encoding: 'utf8', env: { ...process.env, CI: '1' },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

const MALFORMED_TS_003 = {
  id: 'TS-003',
  usId: 'US-101',
  title: 'Wedged suite',
  purpose: 'Reproduces the p2-opus wedge',
  testLevel: 'unit',
  acIds: ['AC-101-1'],
  testCases: [],
  status: 'NOT-A-STATUS',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

async function scaffoldWedge() {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-b5-cli-'));
  await initProject({ projectRoot: tmp, projectName: 'B5CliTest' });
  await writeFile(
    join(tmp, 'rcf/test-suites/ts-003.json'),
    `${JSON.stringify(MALFORMED_TS_003, null, 2)}\n`,
    'utf8',
  );
  return tmp;
}

test('rcf update repairs the malformed doc on a wedged tree (exit 0, warns about pre-existing issues)', async () => {
  const tmp = await scaffoldWedge();
  const { code, stderr } = await runBin(tmp, ['update', 'TS-003', '--set', 'status=draft']);
  assert.equal(code, 0, stderr);
  assert.match(stderr, /\[warn\] tree has 1 pre-existing issue/);
  const repaired = JSON.parse(await readFile(join(tmp, 'rcf/test-suites/ts-003.json'), 'utf8'));
  assert.equal(repaired.status, 'draft');
  const validate = await runBin(tmp, ['validate']);
  assert.equal(validate.code, 0, 'tree is healed after the repair');
});

test('rcf delete removes the malformed doc on a wedged tree (exit 0)', async () => {
  const tmp = await scaffoldWedge();
  const { code, stdout, stderr } = await runBin(tmp, ['delete', 'TS-003']);
  assert.equal(code, 0, stderr);
  assert.match(stdout, /Deleted 1 file/);
  const validate = await runBin(tmp, ['validate']);
  assert.equal(validate.code, 0, 'tree is healed after the delete');
});

test('unrelated create proceeds on a wedged tree (exit 0)', async () => {
  const tmp = await scaffoldWedge();
  const { code, stderr } = await runBin(tmp, ['create', 'req', '--title', 'Written while wedged', '--parent', 'PRD-001']);
  assert.equal(code, 0, stderr);
});

test('net-new breakage on a wedged tree still exits 3', async () => {
  const tmp = await scaffoldWedge();
  const { code, stderr } = await runBin(tmp, ['update', 'REQ-001', '--set', 'priority=irresistible']);
  assert.equal(code, 3);
  assert.match(stderr, /validation/);
});

test('normal-path refusal intact on a valid tree (exit 3, no warn)', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-b5-cli-valid-'));
  await initProject({ projectRoot: tmp, projectName: 'B5CliValidTest' });
  const { code, stderr } = await runBin(tmp, ['update', 'REQ-001', '--set', 'priority=irresistible']);
  assert.equal(code, 3);
  assert.doesNotMatch(stderr, /\[warn\]/);
});
