// `rcf link` / `rcf unlink` subcommand tests (Phase 4 §D19).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { initProject } from '@stravica-ai/rcf-lite-core/store/init.js';

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
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-link-cli-'));
  await initProject({ projectRoot: tmp, projectName: 'LinkTest' });
  return tmp;
}

test('rcf link US-101 --tac TAC-001 appends to tacIds', async () => {
  const tmp = await scaffold();
  const { code } = await runBin(tmp, ['link', 'US-101', '--tac', 'TAC-001']);
  assert.equal(code, 0);
  const us = JSON.parse(await readFile(join(tmp, 'rcf/user-stories/us-101.json'), 'utf8'));
  assert.deepEqual(us.tacIds, ['TAC-001']);
});

test('rcf link is idempotent (already-linked is a no-op)', async () => {
  const tmp = await scaffold();
  await runBin(tmp, ['link', 'US-101', '--tac', 'TAC-001']);
  const { code, stdout } = await runBin(tmp, ['link', 'US-101', '--tac', 'TAC-001']);
  assert.equal(code, 0);
  assert.match(stdout, /already/);
});

test('rcf unlink US-101 --tac TAC-001 removes the entry', async () => {
  const tmp = await scaffold();
  await runBin(tmp, ['link', 'US-101', '--tac', 'TAC-001']);
  const { code } = await runBin(tmp, ['unlink', 'US-101', '--tac', 'TAC-001']);
  assert.equal(code, 0);
  const us = JSON.parse(await readFile(join(tmp, 'rcf/user-stories/us-101.json'), 'utf8'));
  assert.deepEqual(us.tacIds ?? [], []);
});

test('rcf link with an unknown TAC exits 3 (brokenReference)', async () => {
  const tmp = await scaffold();
  const { code, stderr } = await runBin(tmp, ['link', 'US-101', '--tac', 'TAC-999']);
  assert.equal(code, 3);
  assert.match(stderr, /brokenReference/);
});

test('rcf link with no --tac exits 2', async () => {
  const tmp = await scaffold();
  const { code, stderr } = await runBin(tmp, ['link', 'US-101']);
  assert.equal(code, 2);
  assert.match(stderr, /at least one --tac/);
});

test('rcf link --dry-run does not write', async () => {
  const tmp = await scaffold();
  const before = await readFile(join(tmp, 'rcf/user-stories/us-101.json'), 'utf8');
  const { code } = await runBin(tmp, ['link', 'US-101', '--tac', 'TAC-001', '--dry-run']);
  assert.equal(code, 0);
  const after = await readFile(join(tmp, 'rcf/user-stories/us-101.json'), 'utf8');
  assert.equal(after, before);
});
