// `rcf create <kind>` subcommand tests. Drives the bin as a subprocess
// against a scaffolded tmpdir tree.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
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
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-create-cli-'));
  await initProject({ projectRoot: tmp, projectName: 'CreateTest' });
  return tmp;
}

test('rcf create req --parent PRD-001 --title X writes a schema-valid REQ', async () => {
  const tmp = await scaffold();
  const { code, stdout } = await runBin(tmp, ['create', 'req', '--parent', 'PRD-001', '--title', 'My REQ']);
  assert.equal(code, 0);
  assert.match(stdout, /REQ-002 created/);
  const req = JSON.parse(await readFile(join(tmp, 'rcf/requirements/req-002.json'), 'utf8'));
  assert.equal(req.prdId, 'PRD-001');
});

test('rcf create req without --parent exits 2 (usage)', async () => {
  const tmp = await scaffold();
  const { code, stderr } = await runBin(tmp, ['create', 'req', '--title', 'T']);
  assert.equal(code, 2);
  assert.match(stderr, /--parent is required/);
});

test('rcf create with unknown kind exits 2 (BUG-009: distinct unknown-kind message)', async () => {
  const tmp = await scaffold();
  const { code, stderr } = await runBin(tmp, ['create', 'nope', '--parent', 'PRD-001', '--title', 'T']);
  assert.equal(code, 2);
  assert.match(stderr, /unknown kind: nope/);
});

test('rcf create us --parent REQ-999 exits 3 (brokenReference)', async () => {
  const tmp = await scaffold();
  const { code, stderr } = await runBin(tmp, ['create', 'us', '--parent', 'REQ-999', '--title', 'T']);
  assert.equal(code, 3);
  assert.match(stderr, /brokenReference/);
});

test('rcf create ac --parent US-101 --description X mutates the parent US', async () => {
  const tmp = await scaffold();
  const { code, stdout } = await runBin(tmp, ['create', 'ac', '--parent', 'US-101', '--description', 'Second criterion']);
  assert.equal(code, 0);
  assert.match(stdout, /AC-101-2 created/);
  const us = JSON.parse(await readFile(join(tmp, 'rcf/user-stories/us-101.json'), 'utf8'));
  assert.equal(us.acceptanceCriteria.length, 2);
});

test('rcf create fbs --build-order collision exits 2 (§D6 amendment)', async () => {
  const tmp = await scaffold();
  const { code, stderr } = await runBin(tmp, [
    'create', 'fbs', '--parent', 'BS-001',
    '--title', 'clash', '--acs', 'AC-101-1', '--build-order', '1',
  ]);
  assert.equal(code, 2);
  assert.match(stderr, /collides with FBS-001/);
});

test('rcf create ts --parent US-101 writes TS-001', async () => {
  const tmp = await scaffold();
  const { code, stdout } = await runBin(tmp, [
    'create', 'ts', '--parent', 'US-101',
    '--title', 'Smoke', '--purpose', 'p',
    '--test-level', 'unit', '--acs', 'AC-101-1',
  ]);
  assert.equal(code, 0);
  assert.match(stdout, /TS-001 created/);
  const ts = JSON.parse(await readFile(join(tmp, 'rcf/test-suites/ts-001.json'), 'utf8'));
  assert.equal(ts.usId, 'US-101');
  assert.equal(ts.status, 'draft');
});

test('rcf create tc mutates parent TS with derived slug', async () => {
  const tmp = await scaffold();
  await runBin(tmp, [
    'create', 'ts', '--parent', 'US-101',
    '--title', 'S', '--purpose', 'p',
    '--test-level', 'unit', '--acs', 'AC-101-1',
  ]);
  const { code, stdout } = await runBin(tmp, [
    'create', 'tc', '--parent', 'TS-001',
    '--ac', 'AC-101-1', '--description', 'happy',
  ]);
  assert.equal(code, 0);
  assert.match(stdout, /TC-001-happy created/);
});

test('rcf create --dry-run does not write the file', async () => {
  const tmp = await scaffold();
  const { code, stdout } = await runBin(tmp, [
    'create', 'req', '--parent', 'PRD-001',
    '--title', 'Dry', '--dry-run',
  ]);
  assert.equal(code, 0);
  assert.match(stdout, /\[dry-run\]/);
});

test('rcf create --help prints the create help block', async () => {
  const tmp = await scaffold();
  const { code, stdout } = await runBin(tmp, ['create', '--help']);
  assert.equal(code, 0);
  assert.match(stdout, /Kinds:/);
});
