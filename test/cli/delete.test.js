// `rcf delete <id>` subcommand tests. Covers refuse-by-default,
// --cascade, orphan-refuse pre-plan check, and freed-id-non-reuse.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, stat } from 'node:fs/promises';
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

async function scaffold() {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-delete-cli-'));
  await initProject({ projectRoot: tmp, projectName: 'DeleteTest' });
  return tmp;
}

test('rcf delete leaf ADR-001 removes the file (exit 0)', async () => {
  const tmp = await scaffold();
  const { code } = await runBin(tmp, ['delete', 'ADR-001']);
  assert.equal(code, 0);
  await assert.rejects(stat(join(tmp, 'rcf/adrs/adr-001.json')), { code: 'ENOENT' });
});

test('rcf delete REQ-001 without --cascade refuses with exit 4', async () => {
  const tmp = await scaffold();
  const { code, stderr } = await runBin(tmp, ['delete', 'REQ-001']);
  assert.equal(code, 4);
  assert.match(stderr, /has dependents/);
});

test('rcf delete REQ-001 --cascade orphan-refuse fires with exit 4 (§D9 amendment)', async () => {
  const tmp = await scaffold();
  // Scaffold ships FBS-001 referencing AC-101-1 exclusively. Cascade
  // deleting REQ-001 would empty FBS-001.acIds -> refuse.
  const { code, stderr } = await runBin(tmp, ['delete', 'REQ-001', '--cascade']);
  assert.equal(code, 4);
  assert.match(stderr, /orphan/);
});

test('rcf delete AC-101-1 without --cascade refuses (FBS depends) with exit 4', async () => {
  const tmp = await scaffold();
  // First add a second AC so US-101 isn't left empty.
  await runBin(tmp, ['create', 'ac', '--parent', 'US-101', '--description', 'second']);
  const { code, stderr } = await runBin(tmp, ['delete', 'AC-101-1']);
  assert.equal(code, 4);
  assert.match(stderr, /has dependents/);
});

test('rcf delete TS-XXX (no dependents) removes the file (exit 0)', async () => {
  const tmp = await scaffold();
  await runBin(tmp, [
    'create', 'ts', '--parent', 'US-101',
    '--title', 'a', '--purpose', 'p', '--test-level', 'unit', '--acs', 'AC-101-1',
  ]);
  const { code } = await runBin(tmp, ['delete', 'TS-001']);
  assert.equal(code, 0);
  await assert.rejects(stat(join(tmp, 'rcf/test-suites/ts-001.json')), { code: 'ENOENT' });
});

test('rcf delete PRD-001 refuses (root singleton, exit 2)', async () => {
  const tmp = await scaffold();
  const { code, stderr } = await runBin(tmp, ['delete', 'PRD-001']);
  assert.equal(code, 2);
  assert.match(stderr, /root singleton/);
});

test('rcf delete --dry-run does not touch disk', async () => {
  const tmp = await scaffold();
  const before = await stat(join(tmp, 'rcf/adrs/adr-001.json'));
  const { code, stdout } = await runBin(tmp, ['delete', 'ADR-001', '--dry-run']);
  assert.equal(code, 0);
  assert.match(stdout, /\[dry-run\]/);
  const after = await stat(join(tmp, 'rcf/adrs/adr-001.json'));
  assert.equal(after.size, before.size);
});

test('rcf delete freed id: TS-004 is next after deleting TS-002 (§D10 amendment)', async () => {
  const tmp = await scaffold();
  for (let i = 0; i < 3; i += 1) {
    await runBin(tmp, [
      'create', 'ts', '--parent', 'US-101',
      '--title', `s${i}`, '--purpose', 'p', '--test-level', 'unit', '--acs', 'AC-101-1',
    ]);
  }
  await runBin(tmp, ['delete', 'TS-002']);
  const { stdout } = await runBin(tmp, [
    'create', 'ts', '--parent', 'US-101',
    '--title', 'reuse', '--purpose', 'p', '--test-level', 'unit', '--acs', 'AC-101-1',
  ]);
  assert.match(stdout, /TS-004 created/);
});

test('rcf delete UNKNOWN-999 exits 2', async () => {
  const tmp = await scaffold();
  const { code, stderr } = await runBin(tmp, ['delete', 'UNKNOWN-999']);
  assert.equal(code, 2);
  assert.match(stderr, /unrecognised id|not found/);
});
