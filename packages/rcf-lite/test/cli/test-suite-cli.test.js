// `rcf test-suite <ts-id> <verb>` CLI integration tests
// (verification-integrity-cluster-spec §5.1 provenance, §7 approve).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
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

async function scaffoldWithTs(tsStatus = 'draft') {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-ts-cli-'));
  await initProject({ projectRoot: tmp, projectName: 'TsTest' });
  const ts = {
    id: 'TS-001',
    usId: 'US-101',
    status: tsStatus,
    title: 'US-101 coverage',
    purpose: 'Cover AC-101-1',
    testLevel: 'unit',
    acIds: ['AC-101-1'],
    testCases: [
      { id: 'TC-001-happy', acId: 'AC-101-1', description: 'happy', status: 'pending', testPointer: 'test/happy.test.js::happy path' },
      { id: 'TC-001-error', acId: 'AC-101-1', description: 'error', status: 'pending', testPointer: 'test/happy.test.js::error path' },
    ],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
  await writeFile(join(tmp, 'rcf/test-suites/ts-001.json'), `${JSON.stringify(ts, null, 2)}\n`, 'utf8');
  return tmp;
}

test('test-suite provenance writes runtimeProvenance on a single TC via --tc', async () => {
  const tmp = await scaffoldWithTs();
  const { code, stderr } = await runBin(tmp, [
    'test-suite', 'TS-001', 'provenance', '--tc', 'TC-001-happy', '--profile', 'mock', '--notes', 'local fixture only',
  ]);
  assert.equal(code, 0, `stderr=${stderr}`);
  const ts = JSON.parse(await readFile(join(tmp, 'rcf/test-suites/ts-001.json'), 'utf8'));
  const happy = ts.testCases.find((t) => t.id === 'TC-001-happy');
  assert.equal(happy.runtimeProvenance.profile, 'mock');
  assert.equal(happy.runtimeProvenance.notes, 'local fixture only');
  const err = ts.testCases.find((t) => t.id === 'TC-001-error');
  assert.equal(err.runtimeProvenance, undefined, 'other TCs untouched');
});

test('test-suite provenance refuses to overwrite without --force', async () => {
  const tmp = await scaffoldWithTs();
  await runBin(tmp, ['test-suite', 'TS-001', 'provenance', '--tc', 'TC-001-happy', '--profile', 'mock']);
  const { code, stderr } = await runBin(tmp, ['test-suite', 'TS-001', 'provenance', '--tc', 'TC-001-happy', '--profile', 'live']);
  assert.equal(code, 4);
  assert.match(stderr, /already carries runtimeProvenance; re-run with --force/);
});

test('test-suite provenance --force overwrites', async () => {
  const tmp = await scaffoldWithTs();
  await runBin(tmp, ['test-suite', 'TS-001', 'provenance', '--tc', 'TC-001-happy', '--profile', 'mock']);
  const { code } = await runBin(tmp, ['test-suite', 'TS-001', 'provenance', '--tc', 'TC-001-happy', '--profile', 'live', '--force']);
  assert.equal(code, 0);
  const ts = JSON.parse(await readFile(join(tmp, 'rcf/test-suites/ts-001.json'), 'utf8'));
  assert.equal(ts.testCases.find((t) => t.id === 'TC-001-happy').runtimeProvenance.profile, 'live');
});

test('test-suite provenance without --tc writes provenance on every TC lacking a block', async () => {
  const tmp = await scaffoldWithTs();
  const { code } = await runBin(tmp, ['test-suite', 'TS-001', 'provenance', '--profile', 'mock']);
  assert.equal(code, 0);
  const ts = JSON.parse(await readFile(join(tmp, 'rcf/test-suites/ts-001.json'), 'utf8'));
  for (const tc of ts.testCases) {
    assert.equal(tc.runtimeProvenance.profile, 'mock', `${tc.id} got provenance`);
  }
});

test('test-suite provenance refuses --notes that look like they carry a secret', async () => {
  const tmp = await scaffoldWithTs();
  const { code, stderr } = await runBin(tmp, [
    'test-suite', 'TS-001', 'provenance', '--tc', 'TC-001-happy', '--profile', 'live',
    '--notes', 'RESEND_API_KEY=sk_test_abcdefghijklmnopqrstuv',
  ]);
  assert.equal(code, 2);
  assert.match(stderr, /looks like it contains a token or secret/);
});

test('test-suite provenance refuses unknown --profile', async () => {
  const tmp = await scaffoldWithTs();
  const { code, stderr } = await runBin(tmp, ['test-suite', 'TS-001', 'provenance', '--profile', 'whatever']);
  assert.equal(code, 2);
  assert.match(stderr, /unknown --profile/);
});

test('test-suite approve promotes draft -> approved', async () => {
  const tmp = await scaffoldWithTs('draft');
  const { code } = await runBin(tmp, ['test-suite', 'TS-001', 'approve']);
  assert.equal(code, 0);
  const ts = JSON.parse(await readFile(join(tmp, 'rcf/test-suites/ts-001.json'), 'utf8'));
  assert.equal(ts.status, 'approved');
});

test('test-suite approve refuses to promote a superseded TS without --force', async () => {
  const tmp = await scaffoldWithTs('superseded');
  const { code, stderr } = await runBin(tmp, ['test-suite', 'TS-001', 'approve']);
  assert.equal(code, 4);
  assert.match(stderr, /superseded; re-run with --force/);
});

test('test-suite approve --force promotes needsRevision -> approved', async () => {
  const tmp = await scaffoldWithTs('needsRevision');
  const { code } = await runBin(tmp, ['test-suite', 'TS-001', 'approve', '--force']);
  assert.equal(code, 0);
  const ts = JSON.parse(await readFile(join(tmp, 'rcf/test-suites/ts-001.json'), 'utf8'));
  assert.equal(ts.status, 'approved');
});

test('test-suite approve is a no-op when already approved', async () => {
  const tmp = await scaffoldWithTs('approved');
  const { code, stdout } = await runBin(tmp, ['test-suite', 'TS-001', 'approve']);
  assert.equal(code, 0);
  assert.match(stdout, /already approved/);
});

// ---------------------------------------------------------------------------
// 0.8.0 slug-train landmine 3 consumer-path straggler: `rcf test-suite`
// used to gate its TS positional on `^TS-\d{3}$` and hard-refuse any TS
// >= 1000 even though rcf-schemas 0.4.3 admits it. Widened to `\d{3,}`.
// ---------------------------------------------------------------------------
async function scaffoldWithFourDigitTs(tsStatus = 'draft') {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-ts-cli-4digit-'));
  await initProject({ projectRoot: tmp, projectName: 'TsFourDigitTest' });
  const ts = {
    id: 'TS-1000',
    usId: 'US-101',
    status: tsStatus,
    title: 'US-101 coverage (four-digit)',
    purpose: 'Cover AC-101-1 with a widened TS id',
    testLevel: 'unit',
    acIds: ['AC-101-1'],
    testCases: [
      { id: 'TC-1000-happy', acId: 'AC-101-1', description: 'happy', status: 'pending', testPointer: 'test/happy.test.js::happy path' },
    ],
    createdAt: '2026-08-12T00:00:00Z',
    updatedAt: '2026-08-12T00:00:00Z',
  };
  await writeFile(join(tmp, 'rcf/test-suites/ts-1000.json'), `${JSON.stringify(ts, null, 2)}\n`, 'utf8');
  return tmp;
}

test('rcf test-suite TS-1000 provenance accepts a four-digit TS id (0.8.0 landmine 3, consumer-path)', async () => {
  const tmp = await scaffoldWithFourDigitTs();
  const { code, stderr } = await runBin(tmp, [
    'test-suite', 'TS-1000', 'provenance', '--tc', 'TC-1000-happy', '--profile', 'mock', '--notes', 'four-digit ok',
  ]);
  assert.equal(code, 0, `stderr=${stderr}`);
  const ts = JSON.parse(await readFile(join(tmp, 'rcf/test-suites/ts-1000.json'), 'utf8'));
  const happy = ts.testCases.find((t) => t.id === 'TC-1000-happy');
  assert.equal(happy.runtimeProvenance.profile, 'mock');
});

test('rcf test-suite TS-1000 approve accepts a four-digit TS id (0.8.0 landmine 3, consumer-path)', async () => {
  const tmp = await scaffoldWithFourDigitTs('draft');
  const { code } = await runBin(tmp, ['test-suite', 'TS-1000', 'approve']);
  assert.equal(code, 0);
  const ts = JSON.parse(await readFile(join(tmp, 'rcf/test-suites/ts-1000.json'), 'utf8'));
  assert.equal(ts.status, 'approved');
});

test('rcf test-suite refuses a non-TS positional and cites both three-digit and four-digit shapes (0.8.0 landmine 3, error-text update)', async () => {
  const tmp = await scaffoldWithTs();
  const { code, stderr } = await runBin(tmp, ['test-suite', 'not-a-ts-id', 'approve']);
  assert.equal(code, 2);
  assert.match(stderr, /expected a TS id/);
  assert.match(stderr, /TS-1000/, 'error text must cite the widened shape now that four-digit TS ids are admissible');
});
