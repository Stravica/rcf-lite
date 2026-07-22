// `rcf build` bin-invocation tests (Phase 6 §3.4) + golden-file tests
// against the committed dogfood tree (fixtures under
// test/build/fixtures/, regenerated + committed on any tree change).

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
const repoRoot = resolve(here, '..', '..');
const bin = resolve(repoRoot, 'bin', 'rcf.js');
const fixturesDir = resolve(repoRoot, 'test', 'build', 'fixtures');

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
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-build-cli-'));
  await initProject({ projectRoot: tmp, projectName: 'BuildTest' });
  return tmp;
}

// Add a second FBS depending on FBS-001 so blocked-state paths are testable.
async function addDependentFbs(tmp) {
  const fbs = {
    fbsId: 'FBS-002',
    prdId: 'PRD-001',
    bsId: 'BS-001',
    buildOrder: 2,
    executionStatus: 'notStarted',
    title: 'Dependent slice',
    summary: 'Depends on FBS-001.',
    acIds: ['AC-101-1'],
    dependsOnFbsIds: ['FBS-001'],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
  await writeFile(join(tmp, 'rcf/fbs/fbs-002.json'), `${JSON.stringify(fbs, null, 2)}\n`, 'utf8');
}

async function readFbs(tmp, id = 'fbs-001') {
  return JSON.parse(await readFile(join(tmp, `rcf/fbs/${id}.json`), 'utf8'));
}

test('rcf build (queue overview) exits 0 and renders the table', async () => {
  const tmp = await scaffold();
  const { code, stdout } = await runBin(tmp, ['build']);
  assert.equal(code, 0);
  assert.match(stdout, /# Build queue: BS-001/);
  assert.match(stdout, /\| 1 \| FBS-001 \|/);
  assert.match(stdout, /Next actionable: FBS-001/);
});

test('rcf build --format json emits the D14 queue envelope', async () => {
  const tmp = await scaffold();
  const { code, stdout } = await runBin(tmp, ['build', '--format', 'json']);
  assert.equal(code, 0);
  const body = JSON.parse(stdout);
  assert.equal(body.ok, true);
  assert.equal(body.mode, 'queue');
  assert.equal(body.nextActionable, 'FBS-001');
  assert.equal(body.items[0].state, 'actionable');
});

test('rcf build FBS-001 (bundle) exits 0 with the seven-section document', async () => {
  const tmp = await scaffold();
  const { code, stdout } = await runBin(tmp, ['build', 'FBS-001']);
  assert.equal(code, 0);
  assert.match(stdout, /# Spec bundle: FBS-001/);
  assert.match(stdout, /## 7\. Build-cycle runbook/);
});

test('unknown id exits 2', async () => {
  const tmp = await scaffold();
  const { code, stderr } = await runBin(tmp, ['build', 'FBS-999']);
  assert.equal(code, 2);
  assert.match(stderr, /id FBS-999 not found/);
});

test('US id exits 2 with the rcf trace pointer (D1)', async () => {
  const tmp = await scaffold();
  const { code, stderr } = await runBin(tmp, ['build', 'US-101']);
  assert.equal(code, 2);
  assert.match(stderr, /rcf trace US-101 --forward --format json/);
});

test('--next selects the lowest-order actionable item and emits its bundle', async () => {
  const tmp = await scaffold();
  await addDependentFbs(tmp);
  const { code, stdout } = await runBin(tmp, ['build', '--next', '--format', 'json']);
  assert.equal(code, 0);
  const body = JSON.parse(stdout);
  assert.equal(body.mode, 'next');
  assert.equal(body.fbs.fbsId, 'FBS-001');
});

test('--next on an exhausted queue exits 0 with queueEmpty: true (OQ-P6-2)', async () => {
  const tmp = await scaffold();
  // Phase 10 D17: the mark-complete CN gate refuses without CN coverage
  // or a --no-code-nodes declaration - this fixture has no source tree.
  const first = await runBin(tmp, ['build', 'FBS-001', '--mark', 'complete', '--no-code-nodes']);
  assert.equal(first.code, 0);
  const { code, stdout } = await runBin(tmp, ['build', '--next', '--format', 'json']);
  assert.equal(code, 0);
  const body = JSON.parse(stdout);
  assert.equal(body.queueEmpty, true);
});

test('--next distinguishes stuck (blocked/inProgress) from done', async () => {
  const tmp = await scaffold();
  await addDependentFbs(tmp);
  const mark = await runBin(tmp, ['build', 'FBS-001', '--mark', 'inProgress']);
  assert.equal(mark.code, 0);
  const { code, stdout } = await runBin(tmp, ['build', '--next', '--format', 'json']);
  assert.equal(code, 0);
  const body = JSON.parse(stdout);
  assert.equal(body.queueEmpty, false);
  assert.deepEqual(body.blocked, ['FBS-002']);
  assert.deepEqual(body.inProgress, ['FBS-001']);
});

test('--mark writes through updateDocument: status changed, updatedAt bumped', async () => {
  const tmp = await scaffold();
  const before = await readFbs(tmp);
  const { code, stdout } = await runBin(tmp, ['build', 'FBS-001', '--mark', 'inProgress']);
  assert.equal(code, 0);
  assert.match(stdout, /marked FBS-001 notStarted -> inProgress/);
  const after = await readFbs(tmp);
  assert.equal(after.executionStatus, 'inProgress');
  assert.notEqual(after.updatedAt, before.updatedAt);
  assert.equal(after.createdAt, before.createdAt);
});

test('same-status --mark is an idempotent no-op, exit 0', async () => {
  const tmp = await scaffold();
  await runBin(tmp, ['build', 'FBS-001', '--mark', 'inProgress']);
  const { code, stdout } = await runBin(tmp, ['build', 'FBS-001', '--mark', 'inProgress']);
  assert.equal(code, 0);
  assert.match(stdout, /FBS-001 already inProgress/);
});

test('backward --mark exits 4 and names the rcf update escape hatch', async () => {
  const tmp = await scaffold();
  // Phase 10 D17: no CN coverage in this fixture - declare no-code-nodes.
  await runBin(tmp, ['build', 'FBS-001', '--mark', 'complete', '--no-code-nodes']);
  const { code, stderr } = await runBin(tmp, ['build', 'FBS-001', '--mark', 'notStarted']);
  assert.equal(code, 4);
  assert.match(stderr, /\[error\] refused/);
  assert.match(stderr, /rcf update FBS-001 --set executionStatus=notStarted/);
});

test('--mark verified is refused (exit 4), names rcf finalise, and writes nothing (mark ladder caps at complete)', async () => {
  const tmp = await scaffold();
  // Take FBS-001 to complete first, so this is a "complete -> verified" attempt
  // (the exact sidestep the hardening closes), not a backward mark.
  await runBin(tmp, ['build', 'FBS-001', '--mark', 'complete', '--no-code-nodes']);
  const { code, stderr } = await runBin(tmp, ['build', 'FBS-001', '--mark', 'verified']);
  assert.equal(code, 4);
  assert.match(stderr, /\[error\] refused/);
  assert.match(stderr, /rcf finalise FBS-001/);
  assert.match(stderr, /rcf update FBS-001 --set executionStatus=verified/);
  // No write landed: the FBS is still complete, not verified.
  const fbs = await readFbs(tmp);
  assert.equal(fbs.executionStatus, 'complete');
});

test('the sanctioned manual override still works: rcf update --set executionStatus=verified', async () => {
  const tmp = await scaffold();
  await runBin(tmp, ['build', 'FBS-001', '--mark', 'complete', '--no-code-nodes']);
  const { code } = await runBin(tmp, ['update', 'FBS-001', '--set', 'executionStatus=verified']);
  assert.equal(code, 0);
  const fbs = await readFbs(tmp);
  assert.equal(fbs.executionStatus, 'verified', 'rcf update remains the explicit verified override');
});

test('bad --mark value exits 2', async () => {
  const tmp = await scaffold();
  const { code, stderr } = await runBin(tmp, ['build', 'FBS-001', '--mark', 'done']);
  assert.equal(code, 2);
  assert.match(stderr, /unknown --mark value 'done'/);
});

test('--mark on a broken tree exits 3; no write lands (D6)', async () => {
  const tmp = await scaffold();
  const reqPath = join(tmp, 'rcf/requirements/req-001.json');
  const req = JSON.parse(await readFile(reqPath, 'utf8'));
  req.prdId = 'PRD-999';
  await writeFile(reqPath, JSON.stringify(req), 'utf8');
  const { code, stderr } = await runBin(tmp, ['build', 'FBS-001', '--mark', 'complete']);
  assert.equal(code, 3);
  assert.match(stderr, /brokenReference/);
  const fbs = await readFbs(tmp);
  assert.equal(fbs.executionStatus, 'notStarted');
});

test('blocked bundle warns by default (exit 0), --strict refuses (exit 4) (D12)', async () => {
  const tmp = await scaffold();
  await addDependentFbs(tmp);
  const warn = await runBin(tmp, ['build', 'FBS-002']);
  assert.equal(warn.code, 0);
  assert.match(warn.stdout, /\*\*BLOCKED\*\*: unsatisfied dependencies - FBS-001 \(notStarted\)/);
  const strict = await runBin(tmp, ['build', 'FBS-002', '--strict']);
  assert.equal(strict.code, 4);
  assert.match(strict.stderr, /\[error\] refused build: FBS-002 is blocked by FBS-001 \(notStarted\)/);
  assert.equal(strict.stdout, '');
});

test('flag conflicts exit 2 (D1)', async () => {
  const tmp = await scaffold();
  const conflicts = [
    ['build', 'FBS-001', '--next'],
    ['build', 'FBS-001', '--mark', 'complete', '--format', 'json'],
    ['build', 'FBS-001', '--mark', 'complete', '--out', 'x.md'],
    ['build', 'FBS-001', '--mark', 'complete', '--strict'],
    ['build', '--next', '--mark', 'complete'],
    ['build', '--out', 'x.md'],
    ['build', '--strict'],
    ['build', 'FBS-001', 'FBS-002'],
    ['build', 'FBS-*'],
  ];
  for (const args of conflicts) {
    const { code } = await runBin(tmp, args);
    assert.equal(code, 2, `expected exit 2 for: ${args.join(' ')}`);
  }
});

test('--out writes the bundle to a file; parent dir must exist (exit 1 when not)', async () => {
  const tmp = await scaffold();
  const outPath = join(tmp, 'bundle.md');
  const ok = await runBin(tmp, ['build', 'FBS-001', '--out', outPath]);
  assert.equal(ok.code, 0);
  assert.match(ok.stdout, /bundle written to /);
  const written = await readFile(outPath, 'utf8');
  assert.match(written, /# Spec bundle: FBS-001/);
  const bad = await runBin(tmp, ['build', 'FBS-001', '--out', join(tmp, 'no-such-dir', 'bundle.md')]);
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /\[rcf\] unexpected failure/);
});

test('bad --format exits 2', async () => {
  const tmp = await scaffold();
  const { code, stderr } = await runBin(tmp, ['build', '--format', 'yaml']);
  assert.equal(code, 2);
  assert.match(stderr, /unknown --format yaml/);
});

test('bundle output is byte-identical across consecutive invocations (D10)', async () => {
  const tmp = await scaffold();
  const first = await runBin(tmp, ['build', 'FBS-001']);
  const second = await runBin(tmp, ['build', 'FBS-001']);
  assert.equal(first.stdout, second.stdout);
});

// --- Golden files against the committed dogfood tree (§3.4). ---

async function goldenTest(name, args, fixture) {
  const { code, stdout } = await runBin(repoRoot, args);
  assert.equal(code, 0);
  const expected = await readFile(resolve(fixturesDir, fixture), 'utf8');
  assert.equal(
    stdout, expected,
    `\nGolden file mismatch for ${name}. Regenerate with:\n  node bin/rcf.js ${args.join(' ')} > test/build/fixtures/${fixture}\n`,
  );
}

test('golden: rcf build (queue md) matches dogfood fixture', async () => {
  await goldenTest('queue md', ['build'], 'queue.md');
});

test('golden: rcf build --format json (queue) matches dogfood fixture', async () => {
  await goldenTest('queue json', ['build', '--format', 'json'], 'queue.json');
});

test('golden: rcf build FBS-001 (bundle md) matches dogfood fixture', async () => {
  await goldenTest('bundle md', ['build', 'FBS-001'], 'bundle-fbs-001.md');
});

test('golden: rcf build FBS-001 --format json matches dogfood fixture', async () => {
  await goldenTest('bundle json', ['build', 'FBS-001', '--format', 'json'], 'bundle-fbs-001.json');
});
