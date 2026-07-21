// `rcf coverage` bin-invocation tests. Spec §4.5.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
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
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-cov-cli-'));
  await initProject({ projectRoot: tmp, projectName: 'CovTest' });
  return tmp;
}

// Write a TS that fully covers AC-101-1 (the seeded AC on the init tree).
async function addCoveringTs(tmp) {
  const ts = {
    id: 'TS-001',
    usId: 'US-101',
    status: 'draft',
    title: 'US-101 coverage',
    purpose: 'Cover AC-101-1',
    testLevel: 'unit',
    acIds: ['AC-101-1'],
    testCases: [{
      id: 'TC-001-happy-path',
      acId: 'AC-101-1',
      description: 'Happy-path coverage for AC-101-1',
      status: 'pending',
    }],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
  await writeFile(join(tmp, 'rcf/test-suites/ts-001.json'), `${JSON.stringify(ts, null, 2)}\n`, 'utf8');
}

test('rcf coverage on a scaffold with a covering TS exits 0 and reports covered:1', async () => {
  const tmp = await scaffold();
  await addCoveringTs(tmp);
  const { code, stdout } = await runBin(tmp, ['coverage', '--format', 'json']);
  assert.equal(code, 0);
  const body = JSON.parse(stdout);
  assert.equal(body.ok, true);
  assert.equal(body.totals.covered, 1);
});

test('rcf coverage --strict with a gap exits 4', async () => {
  const tmp = await scaffold();
  // No covering TS added - the scaffold has an AC-101-1 with no TC coverage.
  const { code, stderr } = await runBin(tmp, ['coverage', '--strict']);
  assert.equal(code, 4);
  // Nothing on stderr from the compute path; the table went to stdout.
  void stderr;
});

test('rcf coverage --format yaml exits 2 (bad format)', async () => {
  const tmp = await scaffold();
  const { code, stderr } = await runBin(tmp, ['coverage', '--format', 'yaml']);
  assert.equal(code, 2);
  assert.match(stderr, /unknown --format/);
});

test('rcf coverage on a broken tree exits 3 (walker errors block)', async () => {
  const tmp = await scaffold();
  const reqPath = join(tmp, 'rcf/requirements/req-001.json');
  const req = JSON.parse(await readFile(reqPath, 'utf8'));
  req.prdId = 'PRD-999';
  await writeFile(reqPath, JSON.stringify(req), 'utf8');
  const { code, stderr } = await runBin(tmp, ['coverage']);
  assert.equal(code, 3);
  assert.match(stderr, /brokenReference/);
});

test('rcf coverage REQ-001 scopes to a REQ (positional)', async () => {
  const tmp = await scaffold();
  const { code, stdout } = await runBin(tmp, ['coverage', 'REQ-001', '--format', 'json']);
  assert.equal(code, 0);
  const body = JSON.parse(stdout);
  assert.equal(body.totals.requirements, 1);
  assert.equal(body.requirements[0].id, 'REQ-001');
});

test('rcf coverage AC-101-1 (below-AC positional) exits 2', async () => {
  const tmp = await scaffold();
  const { code, stderr } = await runBin(tmp, ['coverage', 'AC-101-1']);
  assert.equal(code, 2);
  assert.match(stderr, /below the AC layer/);
});

test('rcf coverage TAC-001 (off-chain positional) exits 2', async () => {
  const tmp = await scaffold();
  const { code, stderr } = await runBin(tmp, ['coverage', 'TAC-001']);
  assert.equal(code, 2);
  assert.match(stderr, /below the AC layer|off the REQ chain/);
});
