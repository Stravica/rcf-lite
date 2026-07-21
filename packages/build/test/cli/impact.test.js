// `rcf impact <id>` bin-invocation tests. Spec §4.5.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
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
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-impact-cli-'));
  await initProject({ projectRoot: tmp, projectName: 'ImpactTest' });
  return tmp;
}

test('rcf impact TAC-001 includes ancestor TAD-001 with review-arch label', async () => {
  const tmp = await scaffold();
  const { code, stdout } = await runBin(tmp, ['impact', 'TAC-001', '--format', 'json']);
  assert.equal(code, 0);
  const body = JSON.parse(stdout);
  const byId = Object.fromEntries(body.nodes.map((n) => [n.id, n]));
  assert.equal(byId['TAC-001'].role, 'pivot');
  assert.equal(byId['TAD-001'].actionNeeded, 'review-arch');
});

test('rcf impact AC-101-1 includes FBS-001 (fbsByAcId cross-link) with re-execute label', async () => {
  const tmp = await scaffold();
  const { code, stdout } = await runBin(tmp, ['impact', 'AC-101-1', '--format', 'json']);
  assert.equal(code, 0);
  const body = JSON.parse(stdout);
  const byId = Object.fromEntries(body.nodes.map((n) => [n.id, n]));
  assert.equal(byId['AC-101-1'].role, 'pivot');
  // FBS-001 has AC-101-1 in acIds so appears as descendant via fbsByAcId
  assert.equal(byId['FBS-001'].actionNeeded, 're-execute');
});

test('rcf impact renders the actionNeeded column in table format', async () => {
  const tmp = await scaffold();
  const { code, stdout } = await runBin(tmp, ['impact', 'REQ-001']);
  assert.equal(code, 0);
  assert.match(stdout, /Action needed/);
  assert.match(stdout, /review-scope|re-approve/);
});

test('rcf impact JSON envelope shape matches D15', async () => {
  const tmp = await scaffold();
  const { code, stdout } = await runBin(tmp, ['impact', 'AC-101-1', '--format', 'json']);
  assert.equal(code, 0);
  const body = JSON.parse(stdout);
  assert.equal(body.pivot, 'AC-101-1');
  assert.ok(Array.isArray(body.nodes));
  const pivotNode = body.nodes.find((n) => n.id === 'AC-101-1');
  assert.equal(pivotNode.role, 'pivot');
  assert.equal(pivotNode.actionNeeded, null);
});

test('rcf impact NOT-AN-ID exits 2', async () => {
  const tmp = await scaffold();
  const { code, stderr } = await runBin(tmp, ['impact', 'NOT-AN-ID']);
  assert.equal(code, 2);
  assert.match(stderr, /not found/);
});

test('rcf impact with no positional exits 2', async () => {
  const tmp = await scaffold();
  const { code, stderr } = await runBin(tmp, ['impact']);
  assert.equal(code, 2);
  assert.match(stderr, /expected exactly one/);
});
