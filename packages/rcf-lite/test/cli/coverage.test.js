// `rcf coverage` bin-invocation tests. Spec §4.5.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { initProject } from '#core/store/init.js';

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

// Write a TS over AC-101-1 (the seeded AC on the init tree). The TC's
// testPointer targets test/happy.test.js::happy path - resolvable only
// when `withRealTest` also writes that file (w-2026-07-28-005).
async function addCoveringTs(tmp, { withRealTest }) {
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
      testPointer: 'test/happy.test.js::happy path',
    }],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
  await writeFile(join(tmp, 'rcf/test-suites/ts-001.json'), `${JSON.stringify(ts, null, 2)}\n`, 'utf8');
  if (withRealTest) {
    await mkdir(join(tmp, 'test'), { recursive: true });
    await writeFile(join(tmp, 'test/happy.test.js'), "test('happy path', () => {});\n", 'utf8');
  }
}

test('rcf coverage with a TS whose pointer resolves exits 0 and reports covered:1', async () => {
  const tmp = await scaffold();
  await addCoveringTs(tmp, { withRealTest: true });
  const { code, stdout } = await runBin(tmp, ['audit', 'coverage', '--format', 'json']);
  assert.equal(code, 0);
  const body = JSON.parse(stdout);
  assert.equal(body.ok, true);
  assert.equal(body.totals.covered, 1);
  assert.equal(body.totals.coveredUnresolved, 0);
});

test('rcf coverage with a stub TC (pointer does not resolve) reports covered-unresolved, and the default (strict) exits 4', async () => {
  const tmp = await scaffold();
  await addCoveringTs(tmp, { withRealTest: false });
  // REQ-161 (strict-by-default) — pass --mode shallow-any to inspect
  // the covered-unresolved data without tripping the gate.
  const json = await runBin(tmp, ['audit', 'coverage', '--mode', 'shallow-any', '--format', 'json']);
  assert.equal(json.code, 0);
  const body = JSON.parse(json.stdout);
  assert.equal(body.ok, false, 'a stub TC must not report ok');
  assert.equal(body.totals.covered, 0);
  assert.equal(body.totals.coveredUnresolved, 1);
  assert.equal(body.requirements[0].coverageClass, 'covered-unresolved');
  assert.deepEqual(body.unresolvedTestPointers, [{
    tsId: 'TS-001',
    tcId: 'TC-001-happy-path',
    testPointer: 'test/happy.test.js::happy path',
    reason: 'file-missing',
  }]);

  const table = await runBin(tmp, ['audit', 'coverage', '--mode', 'shallow-any']);
  assert.match(table.stdout, /covered-unresolved: 1/);
  assert.match(table.stdout, /TC-001-happy-path\[unresolved\]/);
  assert.match(table.stdout, /Unresolved test pointers \(never counted as coverage\):/);

  // The plain default is strict-by-default from the referee-guarantees
  // train (0.28.0), so a stub coverage fails the gate with no flag.
  const defaultRun = await runBin(tmp, ['audit', 'coverage']);
  assert.equal(defaultRun.code, 4, 'stub coverage must fail the default (strict) gate');

  // The legacy --strict alias behaves identically.
  const strict = await runBin(tmp, ['audit', 'coverage', '--strict']);
  assert.equal(strict.code, 4, 'stub coverage must fail the legacy --strict alias');
});

test('rcf coverage (strict-by-default) with a gap exits 4', async () => {
  const tmp = await scaffold();
  // No covering TS added - the scaffold has an AC-101-1 with no TC coverage.
  // Plain invocation: strict is the default.
  const { code, stderr } = await runBin(tmp, ['audit', 'coverage']);
  assert.equal(code, 4);
  // Nothing on stderr from the compute path; the table went to stdout.
  void stderr;
});

test('rcf coverage --mode shallow-any prints gaps and exits 0 (explicit opt-out)', async () => {
  // REQ-161 (strict-by-default) opt-out: the shallow-any mode is
  // the documented escape valve for author-time exploration.
  const tmp = await scaffold();
  const { code, stdout } = await runBin(tmp, ['audit', 'coverage', '--mode', 'shallow-any']);
  assert.equal(code, 0);
  assert.match(stdout, /Coverage mode: shallow-any/);
});

test('rcf coverage --mode shallow-any --strict exits 2 (conflicting flags)', async () => {
  const tmp = await scaffold();
  const { code, stderr } = await runBin(tmp, ['audit', 'coverage', '--mode', 'shallow-any', '--strict']);
  assert.equal(code, 2);
  assert.match(stderr, /--mode shallow-any conflicts with --strict/);
});

test('rcf coverage --mode unknown exits 2', async () => {
  const tmp = await scaffold();
  const { code, stderr } = await runBin(tmp, ['audit', 'coverage', '--mode', 'lenient']);
  assert.equal(code, 2);
  assert.match(stderr, /unknown --mode lenient/);
});

test('rcf coverage --format yaml exits 2 (bad format)', async () => {
  const tmp = await scaffold();
  const { code, stderr } = await runBin(tmp, ['audit', 'coverage', '--format', 'yaml']);
  assert.equal(code, 2);
  assert.match(stderr, /unknown --format/);
});

test('rcf coverage on a broken tree exits 3 (walker errors block)', async () => {
  const tmp = await scaffold();
  const reqPath = join(tmp, 'rcf/requirements/req-001.json');
  const req = JSON.parse(await readFile(reqPath, 'utf8'));
  req.prdId = 'PRD-999';
  await writeFile(reqPath, JSON.stringify(req), 'utf8');
  const { code, stderr } = await runBin(tmp, ['audit', 'coverage']);
  assert.equal(code, 3);
  assert.match(stderr, /brokenReference/);
});

test('rcf coverage REQ-001 scopes to a REQ (positional)', async () => {
  const tmp = await scaffold();
  // REQ-161 (strict-by-default): the scaffold's REQ-001 has an
  // uncovered AC-101-1, so run in shallow-any so the positional-scope
  // shape is the focus rather than the strict-gate exit code.
  const { code, stdout } = await runBin(tmp, ['audit', 'coverage', 'REQ-001', '--mode', 'shallow-any', '--format', 'json']);
  assert.equal(code, 0);
  const body = JSON.parse(stdout);
  assert.equal(body.totals.requirements, 1);
  assert.equal(body.requirements[0].id, 'REQ-001');
});

test('rcf coverage AC-101-1 (below-AC positional) exits 2', async () => {
  const tmp = await scaffold();
  const { code, stderr } = await runBin(tmp, ['audit', 'coverage', 'AC-101-1']);
  assert.equal(code, 2);
  assert.match(stderr, /below the AC layer/);
});

test('rcf coverage TAC-001 (off-chain positional) exits 2', async () => {
  const tmp = await scaffold();
  const { code, stderr } = await runBin(tmp, ['audit', 'coverage', 'TAC-001']);
  assert.equal(code, 2);
  assert.match(stderr, /below the AC layer|off the REQ chain/);
});
