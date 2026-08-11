// `rcf finalise` integration tests (spec §8 - the build-side finalise-gate).
//
// These prove the load-bearing contract points that unit tests cannot:
//   - verify is launched as a REAL FRESH SUBPROCESS (a stub rcf-verify is
//     executed via node child_process, and it records that it ran) - never an
//     in-process import (§8.2 / §9 independence);
//   - the subprocess EXIT CODE is the gate: exit 0 promotes complete->verified,
//     non-zero leaves the FBS unchanged and surfaces findings (§8.2);
//   - the ISOLATION ENV (§7.3) reaches the subprocess;
//   - findings flow via the --out REPORT FILE, not stdout scraping (§8.2);
//   - the absent-verify path PROMPTS / requires a flag and NEVER silently skips
//     the gate (§8.3).
//
// The stub stands in for rcf-verify by injecting the detection result; the
// spawn itself is the real spawnVerify (not injected), so the process boundary
// and env propagation are genuinely exercised.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initProject } from '@stravica-ai/rcf-lite-core/store/init.js';

import { main as finalise } from '../../src/cli/finalise.js';

function sink() {
  return { data: '', write(s) { this.data += s; } };
}

// A stub rcf-verify: records its argv + the isolation env it was spawned with
// to a marker file, writes the --out report, and exits with STUB_EXIT.
const STUB = `import { writeFileSync } from 'node:fs';
const argv = process.argv.slice(2);
const outIdx = argv.indexOf('--out');
const outPath = argv[outIdx + 1];
writeFileSync(process.env.STUB_MARKER, JSON.stringify({
  argv,
  autoMemoryDisabled: process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY,
  trafficDisabled: process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC,
}), 'utf8');
if (!process.env.STUB_SKIP_REPORT) {
  writeFileSync(outPath, JSON.stringify({
    schemaVersion: '1',
    verdict: process.env.STUB_VERDICT ?? 'PASS',
    verdictAuthority: process.env.STUB_AUTHORITY ?? 'ship',
    run: {
      profile: process.env.STUB_PROFILE ?? 'deployed',
      url: 'https://app.example.com',
      parityEnv: process.env.STUB_PARITY === '1',
    },
    findings: JSON.parse(process.env.STUB_FINDINGS ?? '[]'),
  }), 'utf8');
}
process.exit(Number(process.env.STUB_EXIT ?? '0'));
`;

async function scaffoldComplete() {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-finalise-'));
  await initProject({ projectRoot: tmp, projectName: 'FinaliseTest' });
  // Move FBS-001 to `complete` so the finalise gate is applicable.
  const fbsPath = join(tmp, 'rcf/fbs/fbs-001.json');
  const fbs = JSON.parse(await readFile(fbsPath, 'utf8'));
  fbs.executionStatus = 'complete';
  await writeFile(fbsPath, `${JSON.stringify(fbs, null, 2)}\n`, 'utf8');
  return tmp;
}

async function writeStub(tmp) {
  const stubPath = join(tmp, 'stub-rcf-verify.mjs');
  await writeFile(stubPath, STUB, 'utf8');
  return stubPath;
}

async function readStatus(tmp) {
  const fbs = JSON.parse(await readFile(join(tmp, 'rcf/fbs/fbs-001.json'), 'utf8'));
  return fbs.executionStatus;
}

// Base deps that point finalise at the stub as a real subprocess.
function stubDeps(tmp, stubPath, markerPath, extraEnv = {}) {
  return {
    stdout: sink(),
    stderr: sink(),
    cwd: tmp,
    detectVerify: async () => ({
      installed: true,
      invocation: { command: process.execPath, prefixArgs: [stubPath], source: 'package' },
    }),
    // Real spawnVerify runs; feed it the stub's control env + silence its stdio.
    baseEnv: { ...process.env, STUB_MARKER: markerPath, ...extraEnv },
    stdio: 'ignore',
  };
}

test('finalise: gate PASS (subprocess exit 0) promotes complete -> verified', async () => {
  const tmp = await scaffoldComplete();
  const stubPath = await writeStub(tmp);
  const marker = join(tmp, 'marker.json');
  const deps = stubDeps(tmp, stubPath, marker, { STUB_EXIT: '0', STUB_VERDICT: 'PASS' });

  const code = await finalise(['FBS-001', '--url', 'https://app.example.com', '--profile', 'deployed'], deps);

  assert.equal(code, 0, 'a passing gate exits 0');
  assert.equal(await readStatus(tmp), 'verified', 'the FBS is promoted to verified');

  // Proof the fresh subprocess actually ran, with the §8.2 args + §7.3 isolation env.
  const rec = JSON.parse(await readFile(marker, 'utf8'));
  assert.ok(rec.argv.includes('run'), 'invoked rcf-verify run');
  assert.deepEqual(rec.argv.slice(rec.argv.indexOf('--repo'), rec.argv.indexOf('--repo') + 2), ['--repo', tmp]);
  assert.deepEqual(rec.argv.slice(rec.argv.indexOf('--profile'), rec.argv.indexOf('--profile') + 2), ['--profile', 'deployed']);
  assert.deepEqual(rec.argv.slice(rec.argv.indexOf('--url'), rec.argv.indexOf('--url') + 2), ['--url', 'https://app.example.com']);
  assert.deepEqual(rec.argv.slice(rec.argv.indexOf('--severity-gate'), rec.argv.indexOf('--severity-gate') + 2), ['--severity-gate', 'BROKEN']);
  assert.ok(rec.argv.includes('--out'), 'passes an --out report path');
  assert.equal(rec.autoMemoryDisabled, '1', 'isolation: auto-memory disabled in the subprocess');
  assert.equal(rec.trafficDisabled, '1', 'isolation: non-essential traffic disabled in the subprocess');

  // Report artifact was written (findings flow via file, not stdout).
  const report = JSON.parse(await readFile(join(tmp, '.rcf-verify-report.json'), 'utf8'));
  assert.equal(report.verdict, 'PASS');
});

test('finalise: gate PASS but correctness-only authority HOLDS (exit 4), does NOT promote', async () => {
  // The §4 ship-authority gate (w-2026-07-22-004): a `--profile ci` PASS is a
  // real regression pass (exit 0) but carries no ship authority, so it must hold
  // at `complete` rather than write `verified`.
  const tmp = await scaffoldComplete();
  const stubPath = await writeStub(tmp);
  const marker = join(tmp, 'marker.json');
  const deps = stubDeps(tmp, stubPath, marker, {
    STUB_EXIT: '0', STUB_VERDICT: 'PASS', STUB_AUTHORITY: 'correctness', STUB_PROFILE: 'ci',
  });

  const code = await finalise(['FBS-001', '--url', 'https://app.example.com', '--profile', 'ci'], deps);

  assert.equal(code, 4, 'a passing but non-ship run holds (exit 4)');
  assert.equal(await readStatus(tmp), 'complete', 'the FBS is NOT promoted without ship authority');
  assert.match(deps.stderr.data, /HOLD/);
  assert.match(deps.stderr.data, /ship authority|carries 'correctness' authority/);
  assert.doesNotMatch(deps.stderr.data, /\[error\]/, 'a HOLD is a clean hold, not an error');
});

test('finalise: gate PASS (exit 0) but an unreadable/missing report HOLDS (exit 4), state unchanged', async () => {
  // NIT-3 (w-2026-07-22-004): exit 0 is necessary but not sufficient to write
  // `verified`. When the subprocess passes but the verify report cannot be read,
  // the authority is undetermined - which is treated as a HOLD, never a silent
  // promotion ("unreadable is not a pass"). The FBS stays at `complete`, and the
  // hold note flags that the report could not be read.
  const tmp = await scaffoldComplete();
  const stubPath = await writeStub(tmp);
  const marker = join(tmp, 'marker.json');
  const deps = stubDeps(tmp, stubPath, marker, {
    STUB_EXIT: '0', STUB_SKIP_REPORT: '1',
  });

  const code = await finalise(['FBS-001', '--url', 'https://app.example.com', '--profile', 'deployed'], deps);

  assert.equal(code, 4, 'a pass with an unreadable report holds (exit 4)');
  assert.equal(await readStatus(tmp), 'complete', 'the FBS is NOT promoted when the report is unreadable');
  assert.match(deps.stderr.data, /HOLD/);
  assert.match(deps.stderr.data, /could not be read/);
  assert.doesNotMatch(deps.stderr.data, /\[error\]/, 'a HOLD is a clean hold, not an error');
});

test('finalise: gate PASS with ci + --parity-env carries ship authority and promotes', async () => {
  // The declared-parity path (§4): a ci run with --parity-env is a ship gate.
  const tmp = await scaffoldComplete();
  const stubPath = await writeStub(tmp);
  const marker = join(tmp, 'marker.json');
  const deps = stubDeps(tmp, stubPath, marker, {
    STUB_EXIT: '0', STUB_VERDICT: 'PASS', STUB_AUTHORITY: 'ship', STUB_PROFILE: 'ci', STUB_PARITY: '1',
  });

  const code = await finalise(
    ['FBS-001', '--url', 'https://app.example.com', '--profile', 'ci', '--parity-env'],
    deps,
  );

  assert.equal(code, 0, 'a passing ship-authority run promotes');
  assert.equal(await readStatus(tmp), 'verified');
});

test('finalise: gate FAIL (subprocess exit 5) leaves the FBS unchanged and surfaces findings', async () => {
  const tmp = await scaffoldComplete();
  const stubPath = await writeStub(tmp);
  const marker = join(tmp, 'marker.json');
  const findings = JSON.stringify([{ severity: 'BROKEN', acId: 'AC-101-1', journey: 'sign-in' }]);
  const deps = stubDeps(tmp, stubPath, marker, { STUB_EXIT: '5', STUB_VERDICT: 'BROKEN', STUB_FINDINGS: findings });

  const code = await finalise(['FBS-001', '--url', 'https://app.example.com'], deps);

  assert.equal(code, 4, 'a tripped ship gate refuses finalise (exit 4)');
  assert.equal(await readStatus(tmp), 'complete', 'the FBS is NOT promoted on a failing gate');
  // Findings ingested from the report file and surfaced to the operator.
  assert.match(deps.stderr.data, /gate NOT passed/);
  assert.match(deps.stderr.data, /verdict: BROKEN/);
  assert.match(deps.stderr.data, /BROKEN AC-101-1 \(sign-in\)/);
});

test('finalise: absent rcf-verify PROMPTS and, on accept, installs then runs the gate', async () => {
  const tmp = await scaffoldComplete();
  const stubPath = await writeStub(tmp);
  const marker = join(tmp, 'marker.json');

  let detectCalls = 0;
  let installed = false; let prompted = false;
  const deps = {
    stdout: sink(),
    stderr: sink(),
    cwd: tmp,
    isTty: true,
    // Not installed on the first probe; installed on the post-install re-probe.
    detectVerify: async () => {
      detectCalls += 1;
      if (detectCalls === 1) return { installed: false, invocation: null };
      return { installed: true, invocation: { command: process.execPath, prefixArgs: [stubPath], source: 'package' } };
    },
    promptYesNo: async () => { prompted = true; return true; },
    installVerify: async () => { installed = true; return 0; },
    baseEnv: { ...process.env, STUB_MARKER: marker, STUB_EXIT: '0', STUB_VERDICT: 'PASS' },
    stdio: 'ignore',
  };

  const code = await finalise(['FBS-001', '--url', 'https://app.example.com'], deps);

  assert.ok(prompted, 'prompted the operator to install');
  assert.ok(installed, 'installed rcf-verify after acceptance');
  assert.equal(code, 0, 'gate ran after install and passed');
  assert.equal(await readStatus(tmp), 'verified');
});

test('finalise: absent rcf-verify + declined prompt ABORTS (never silently skips the gate)', async () => {
  const tmp = await scaffoldComplete();
  let installed = false;
  const deps = {
    stdout: sink(),
    stderr: sink(),
    cwd: tmp,
    isTty: true,
    detectVerify: async () => ({ installed: false, invocation: null }),
    promptYesNo: async () => false,
    installVerify: async () => { installed = true; return 0; },
  };

  const code = await finalise(['FBS-001', '--url', 'https://app.example.com'], deps);

  assert.equal(code, 4, 'declining the install aborts finalise');
  assert.equal(installed, false, 'nothing installed');
  assert.equal(await readStatus(tmp), 'complete', 'the gate was not skipped - status unchanged');
  assert.match(deps.stderr.data, /never skipped/i);
});

test('finalise: absent rcf-verify off a TTY without --install-verify ABORTS with the remedy', async () => {
  const tmp = await scaffoldComplete();
  const deps = {
    stdout: sink(),
    stderr: sink(),
    cwd: tmp,
    isTty: false,
    detectVerify: async () => ({ installed: false, invocation: null }),
  };

  const code = await finalise(['FBS-001', '--url', 'https://app.example.com'], deps);

  assert.equal(code, 4);
  assert.match(deps.stderr.data, /--install-verify/);
  assert.equal(await readStatus(tmp), 'complete');
});

test('finalise: refuses an FBS that is not yet complete', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-finalise-ns-'));
  await initProject({ projectRoot: tmp, projectName: 'NotStarted' });
  const deps = { stdout: sink(), stderr: sink(), cwd: tmp, detectVerify: async () => ({ installed: true, invocation: {} }) };

  const code = await finalise(['FBS-001', '--url', 'https://app.example.com'], deps);

  assert.equal(code, 4, 'refuses to finalise a non-complete item');
  assert.match(deps.stderr.data, /rcf build FBS-001 --mark complete/);
});

test('finalise: a non-FBS id is a usage error', async () => {
  const tmp = await scaffoldComplete();
  const deps = { stdout: sink(), stderr: sink(), cwd: tmp };
  const code = await finalise(['US-101', '--url', 'https://app.example.com'], deps);
  assert.equal(code, 2);
});

test('finalise: --provision dash-footgun is refused (credentials never inline)', async () => {
  const tmp = await scaffoldComplete();
  const deps = { stdout: sink(), stderr: sink(), cwd: tmp };
  const code = await finalise(['FBS-001', '--url', 'https://app.example.com', '--provision=-sneaky'], deps);
  assert.equal(code, 2);
  assert.match(deps.stderr.data, /credentials are never accepted inline/);
});

test('finalise: re-verify of an already-verified FBS holds verified on a passing gate', async () => {
  const tmp = await scaffoldComplete();
  // Bump to verified first.
  const fbsPath = join(tmp, 'rcf/fbs/fbs-001.json');
  const fbs = JSON.parse(await readFile(fbsPath, 'utf8'));
  fbs.executionStatus = 'verified';
  await writeFile(fbsPath, `${JSON.stringify(fbs, null, 2)}\n`, 'utf8');

  const stubPath = await writeStub(tmp);
  const marker = join(tmp, 'marker.json');
  const deps = stubDeps(tmp, stubPath, marker, { STUB_EXIT: '0', STUB_VERDICT: 'PASS' });

  const code = await finalise(['FBS-001', '--url', 'https://app.example.com'], deps);
  assert.equal(code, 0);
  assert.equal(await readStatus(tmp), 'verified');
});
