// Phase 10 (X2 CodeNode bridge, D17, operator ruling 2026-07-10) CLI-level
// tests: `rcf build <fbs-id> --mark complete` refuses without CN coverage;
// `--no-code-nodes` declares the exemption on the FBS; the declaration is
// sticky (marking again later does not re-trigger the gate).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
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

async function scaffold(name) {
  const tmp = await mkdtemp(join(tmpdir(), `rcf-gate-cli-${name}-`));
  await initProject({ projectRoot: tmp, projectName: 'GateTest' });
  await mkdir(join(tmp, 'src'), { recursive: true });
  await writeFile(join(tmp, 'src', 'save.js'), 'export function save() {}\n', 'utf8');
  // Scaffold FBS-001 delivers AC-101-1 (initProject wires acIds:['AC-101-1']).
  return tmp;
}

test('rcf build --mark complete is refused (exit 3, missingCodeNodes) when the AC has no CN', async () => {
  const tmp = await scaffold('refused');
  await runBin(tmp, ['build', 'FBS-001', '--mark', 'inProgress']);
  const { code, stderr } = await runBin(tmp, ['build', 'FBS-001', '--mark', 'complete']);
  assert.equal(code, 3);
  assert.match(stderr, /missingCodeNodes/);
  assert.match(stderr, /AC-101-1/);
});

test('rcf build --mark complete succeeds once the AC has a CN', async () => {
  const tmp = await scaffold('passes');
  await runBin(tmp, ['create', 'cn', '--path', 'src/save.js#save', '--acs', 'AC-101-1']);
  await runBin(tmp, ['build', 'FBS-001', '--mark', 'inProgress']);
  const { code, stdout } = await runBin(tmp, ['build', 'FBS-001', '--mark', 'complete']);
  assert.equal(code, 0, stdout);
  assert.match(stdout, /marked FBS-001 inProgress -> complete/);
});

test('rcf build --mark complete --no-code-nodes bypasses the gate and records the declaration', async () => {
  const tmp = await scaffold('declared');
  await runBin(tmp, ['build', 'FBS-001', '--mark', 'inProgress']);
  const { code, stdout } = await runBin(tmp, ['build', 'FBS-001', '--mark', 'complete', '--no-code-nodes']);
  assert.equal(code, 0, stdout);
  const read = await runBin(tmp, ['read', 'FBS-001']);
  const body = JSON.parse(read.stdout);
  assert.equal(body.noCodeNodes, true);
});

test('the no-code-nodes declaration is sticky: a later re-mark does not re-trigger the gate', async () => {
  const tmp = await scaffold('sticky');
  await runBin(tmp, ['build', 'FBS-001', '--mark', 'inProgress']);
  await runBin(tmp, ['build', 'FBS-001', '--mark', 'complete', '--no-code-nodes']);
  // Deliberate correction back to inProgress, then complete again with no
  // --no-code-nodes flag on the second pass - the FBS already carries the
  // declaration, so the gate must not re-fire.
  await runBin(tmp, ['update', 'FBS-001', '--set', 'executionStatus=inProgress']);
  const { code, stdout } = await runBin(tmp, ['build', 'FBS-001', '--mark', 'complete']);
  assert.equal(code, 0, stdout);
});

test('--no-code-nodes only combines with --mark complete (exit 2 otherwise)', async () => {
  const tmp = await scaffold('flag-conflict');
  const { code, stderr } = await runBin(tmp, ['build', 'FBS-001', '--mark', 'inProgress', '--no-code-nodes']);
  assert.equal(code, 2);
  assert.match(stderr, /--no-code-nodes only combines with --mark complete/);
});

test('rcf coverage --with-code reports the four classes and never blocks', async () => {
  const tmp = await scaffold('coverage');
  await runBin(tmp, ['create', 'ac', '--parent', 'US-101', '--description', 'A second acceptance criterion']);
  await runBin(tmp, ['create', 'cn', '--path', 'src/save.js#save', '--acs', 'AC-101-1']);
  await runBin(tmp, ['create', 'cn', '--path', 'src/orphan.js']);
  const { code, stdout } = await runBin(tmp, ['coverage', '--with-code', '--format', 'json']);
  assert.equal(code, 0, stdout);
  const body = JSON.parse(stdout);
  assert.equal(body.withCode, true);
  const ac1 = body.requirements.flatMap((r) => r.acs).find((a) => a.id === 'AC-101-1');
  assert.equal(ac1.codeClass, 'implemented-uncovered');
  const ac2 = body.requirements.flatMap((r) => r.acs).find((a) => a.id === 'AC-101-2');
  assert.equal(ac2.codeClass, 'unimplemented');
  assert.deepEqual(body.codeNodeOrphans, ['CN-002']);
});
