// Issue 330 (2026-10-08) finalise-side coverage:
//   1. --mode threads through to the fresh verify subprocess (argv shape).
//   2. Deterministic-mode BLOCKED verdict is refused at the gate with
//      the counts line (ADR-4112 verified invariant).
//   3. Deterministic-mode PASS with skipped>0 is ALSO refused (no quiet
//      promotion).
//   4. Partial-report fallback: when verify exits non-zero without
//      replacing the preseed stub, the gate-NOT-passed path overwrites
//      the stub with an `aborted` record naming the mode and the exit
//      code — never leaves the operator reading ENOENT.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initProject } from '#core/store/init.js';

import { main as finalise } from '../../src/cli/finalise.js';
import { buildVerifyArgs } from '../../src/finalise/spawn.js';

function sink() { return { data: '', write(s) { this.data += s; } }; }

async function scaffoldComplete() {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-finalise-330-'));
  await initProject({ projectRoot: tmp, projectName: 'FinaliseTest' });
  const fbsPath = join(tmp, 'rcf/fbs/fbs-001.json');
  const fbs = JSON.parse(await readFile(fbsPath, 'utf8'));
  fbs.executionStatus = 'complete';
  await writeFile(fbsPath, `${JSON.stringify(fbs, null, 2)}\n`, 'utf8');
  return tmp;
}

const DETECTED = { installed: true, invocation: { command: 'node', prefixArgs: [] } };

test('buildVerifyArgs: --mode threads through to the fresh subprocess argv', () => {
  const args = buildVerifyArgs({
    repo: '/r', url: 'https://app', profile: 'deployed',
    out: '/r/.rcf-verify-report.json', severityGate: 'BROKEN',
    mode: 'deterministic',
  });
  const i = args.indexOf('--mode');
  assert.notEqual(i, -1);
  assert.equal(args[i + 1], 'deterministic');
});

test('finalise: deterministic-mode BLOCKED is refused with counts line (ADR-4112)', async () => {
  const tmp = await scaffoldComplete();
  const stdout = sink();
  const stderr = sink();
  const report = {
    schemaVersion: '1',
    verdict: 'BLOCKED',
    verdictAuthority: null,
    run: {
      profile: 'deployed',
      url: 'https://app.example.com',
      runStats: {
        mode: 'deterministic',
        counts: { total: 3, verified: 0, failed: 0, skipped: 3 },
      },
    },
    findings: [],
    blockedAcs: [
      { acId: 'AC-101-1', reason: 'critique-only', mode: 'deterministic' },
    ],
  };
  const spawnVerifyFake = async ({ verifyArgs }) => {
    // Simulate a BLOCKED verify run: write the report and exit 5.
    const outIdx = verifyArgs.indexOf('--out');
    await writeFile(verifyArgs[outIdx + 1], JSON.stringify(report), 'utf8');
    return { code: 5, signal: null, env: {} };
  };
  const code = await finalise(['FBS-001', '--url', 'https://app.example.com', '--mode', 'deterministic'], {
    stdout, stderr, cwd: tmp,
    detectVerify: async () => DETECTED,
    spawnVerify: spawnVerifyFake,
  });
  // Exit 4: gate NOT passed, FBS left 'complete'.
  assert.equal(code, 4);
  const fbs = JSON.parse(await readFile(join(tmp, 'rcf/fbs/fbs-001.json'), 'utf8'));
  assert.equal(fbs.executionStatus, 'complete');
  assert.match(stderr.data, /gate NOT passed/);
});

test('finalise: deterministic-mode PASS with skipped>0 is REFUSED (never silently promotes)', async () => {
  const tmp = await scaffoldComplete();
  const stdout = sink();
  const stderr = sink();
  // A pathological deterministic run that passed one AC and skipped
  // two (future catalog partial coverage). The gate must refuse per
  // the ADR-4112 verified invariant.
  const report = {
    schemaVersion: '1',
    verdict: 'PASS',
    verdictAuthority: 'ship',
    run: {
      profile: 'deployed',
      url: 'https://app.example.com',
      runStats: {
        mode: 'deterministic',
        counts: { total: 3, verified: 1, failed: 0, skipped: 2 },
      },
    },
    findings: [
      { severity: 'PASS', acId: 'AC-101-1', journey: 'landing', reproSteps: ['200'], evidence: { kind: 'note', detail: 'ok' } },
    ],
    blockedAcs: [
      { acId: 'AC-101-2', reason: 'critique-only', mode: 'deterministic' },
      { acId: 'AC-101-3', reason: 'critique-only', mode: 'deterministic' },
    ],
  };
  const spawnVerifyFake = async ({ verifyArgs }) => {
    const outIdx = verifyArgs.indexOf('--out');
    await writeFile(verifyArgs[outIdx + 1], JSON.stringify(report), 'utf8');
    return { code: 0, signal: null, env: {} };
  };
  const code = await finalise(['FBS-001', '--url', 'https://app.example.com', '--mode', 'deterministic', '--allow-pre-merge'], {
    stdout, stderr, cwd: tmp,
    detectVerify: async () => DETECTED,
    spawnVerify: spawnVerifyFake,
  });
  assert.equal(code, 4);
  assert.match(stderr.data, /deterministic mode verified 1 of 3 ACs/);
  assert.match(stderr.data, /ADR-4112/);
  const fbs = JSON.parse(await readFile(join(tmp, 'rcf/fbs/fbs-001.json'), 'utf8'));
  assert.equal(fbs.executionStatus, 'complete');
});

test('finalise: verify exits non-zero without writing report -> partial `aborted` record overwrites the preseed stub', async () => {
  const tmp = await scaffoldComplete();
  const stdout = sink();
  const stderr = sink();
  // Fake verify that exits non-zero WITHOUT writing to --out (killed
  // by harness, failed to start, etc.). The finalise CLI preseeded
  // the file; after the spawn result, finalise should overwrite the
  // preseed stub with an `aborted` record naming the mode + exit.
  const spawnVerifyFake = async () => ({ code: 1, signal: null, env: {} });
  const code = await finalise(['FBS-001', '--url', 'https://app.example.com', '--mode', 'deterministic'], {
    stdout, stderr, cwd: tmp,
    detectVerify: async () => DETECTED,
    spawnVerify: spawnVerifyFake,
  });
  assert.equal(code, 1);
  // The report file must now be an aborted record, not an ENOENT.
  const outPath = join(tmp, '.rcf-verify-report.json');
  const report = JSON.parse(await readFile(outPath, 'utf8'));
  assert.equal(report.verdict, 'LAUNCH-FAILURE');
  assert.equal(report.run.runStats.mode, 'deterministic');
  assert.equal(report.run.runStats.status, 'aborted');
  assert.equal(report.run.runStats.exitCode, 1);
  assert.equal(report.launchFailure.status, 'aborted');
  assert.match(stderr.data, /gate NOT passed/);
  assert.match(stderr.data, /mode=deterministic/);
});

test('finalise: --mode unknown value is a usage error (exit 2)', async () => {
  const tmp = await scaffoldComplete();
  const stderr = sink();
  const code = await finalise(['FBS-001', '--url', 'https://app.example.com', '--mode', 'determinstic'], {
    stdout: sink(), stderr, cwd: tmp,
    detectVerify: async () => DETECTED,
    spawnVerify: async () => ({ code: 0, signal: null, env: {} }),
  });
  assert.equal(code, 2);
  assert.match(stderr.data, /--mode must be one of/);
});
