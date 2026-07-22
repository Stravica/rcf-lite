// Unit coverage for the finalise-gate building blocks (spec §8). The
// load-bearing end-to-end gate (real subprocess spawn + exit-code gate + report
// ingest) is proven in test/cli/finalise.test.js; this file pins the pure and
// injectable seams.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildVerifyArgs,
  summariseReport,
  loadReport,
  detectVerify,
  findOnPath,
  resolvePackageBin,
  resolveAbsentVerify,
  VERIFY_PACKAGE,
} from '../../src/finalise/index.js';

function sink() {
  return { data: '', write(s) { this.data += s; } };
}

// --- buildVerifyArgs: the §8.2 invocation contract ------------------------

test('buildVerifyArgs emits the required §8.2 flags in order', () => {
  const args = buildVerifyArgs({
    repo: '/proj', url: 'https://app', profile: 'deployed', out: '/proj/r.json', severityGate: 'BROKEN',
  });
  assert.deepEqual(args, [
    'run', '--repo', '/proj', '--profile', 'deployed', '--url', 'https://app',
    '--severity-gate', 'BROKEN', '--out', '/proj/r.json',
  ]);
});

test('buildVerifyArgs appends optional flags only when present', () => {
  const args = buildVerifyArgs({
    repo: '/proj', url: 'https://app', profile: 'ci', out: '/r.json', severityGate: 'DEGRADED',
    parityEnv: true, provision: '/creds.json', chain: 'PRD-002', persona: 'sceptic',
  });
  assert.ok(args.includes('--parity-env'));
  assert.deepEqual(args.slice(args.indexOf('--provision'), args.indexOf('--provision') + 2), ['--provision', '/creds.json']);
  assert.deepEqual(args.slice(args.indexOf('--chain'), args.indexOf('--chain') + 2), ['--chain', 'PRD-002']);
  assert.deepEqual(args.slice(args.indexOf('--persona'), args.indexOf('--persona') + 2), ['--persona', 'sceptic']);
});

test('buildVerifyArgs omits --parity-env / --provision when falsy', () => {
  const args = buildVerifyArgs({
    repo: '/p', url: 'https://a', profile: 'deployed', out: '/r', severityGate: 'BROKEN', parityEnv: false,
  });
  assert.ok(!args.includes('--parity-env'));
  assert.ok(!args.includes('--provision'));
});

// --- summariseReport: the §5.4 findings seam ------------------------------

test('summariseReport surfaces verdict, runtime provenance and per-AC findings', () => {
  const out = summariseReport({
    verdict: 'BROKEN', verdictAuthority: 'ship',
    run: { profile: 'deployed', url: 'https://app', parityEnv: false },
    findings: [{ severity: 'BROKEN', acId: 'AC-101-8', journey: 'sign-in' }],
  });
  assert.match(out, /verdict: BROKEN \[ship\]/);
  assert.match(out, /profile=deployed url=https:\/\/app/);
  assert.match(out, /BROKEN AC-101-8 \(sign-in\)/);
});

test('summariseReport surfaces blocked ACs and launch failures', () => {
  const out = summariseReport({
    verdict: 'LAUNCH-FAILURE', run: {},
    findings: [], blockedAcs: [{ acId: 'AC-203-1', reason: 'no sandbox key' }],
    launchFailure: { message: 'agent did not start' },
  });
  assert.match(out, /blocked ACs \(1\)/);
  assert.match(out, /AC-203-1: no sandbox key/);
  assert.match(out, /launch failure: agent did not start/);
});

// --- loadReport -----------------------------------------------------------

test('loadReport parses a JSON report artifact', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fin-load-'));
  const p = join(dir, 'r.json');
  await writeFile(p, JSON.stringify({ schemaVersion: '1', verdict: 'PASS' }), 'utf8');
  const res = await loadReport(p);
  assert.equal(res.ok, true);
  assert.equal(res.report.verdict, 'PASS');
});

test('loadReport degrades (never throws) on a missing report', async () => {
  const res = await loadReport('/no/such/report.json');
  assert.equal(res.ok, false);
  assert.match(res.reason, /report not found/);
});

test('loadReport degrades on invalid JSON', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fin-bad-'));
  const p = join(dir, 'r.json');
  await writeFile(p, '{ not json', 'utf8');
  const res = await loadReport(p);
  assert.equal(res.ok, false);
  assert.match(res.reason, /not valid JSON/);
});

// --- detection ------------------------------------------------------------

test('findOnPath returns an executable found on PATH', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fin-path-'));
  const bin = join(dir, 'rcf-verify');
  await writeFile(bin, '#!/bin/sh\necho hi\n', 'utf8');
  await chmod(bin, 0o755);
  const found = await findOnPath('rcf-verify', { env: { PATH: `/nonexistent:${dir}` } });
  assert.equal(found, bin);
});

test('findOnPath returns null when absent from PATH', async () => {
  const found = await findOnPath('rcf-verify', { env: { PATH: '/nonexistent' } });
  assert.equal(found, null);
});

test('resolvePackageBin returns null when the package is not installed nearby', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fin-res-'));
  const res = await resolvePackageBin(dir);
  assert.equal(res, null);
});

test('detectVerify reports installed with a PATH invocation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fin-det-'));
  const bin = join(dir, 'rcf-verify');
  await writeFile(bin, '#!/bin/sh\n', 'utf8');
  await chmod(bin, 0o755);
  const det = await detectVerify({
    findOnPath: async () => bin,
  });
  assert.equal(det.installed, true);
  assert.equal(det.invocation.command, bin);
  assert.deepEqual(det.invocation.prefixArgs, []);
});

test('detectVerify reports installed with a package invocation (node + entry)', async () => {
  const det = await detectVerify({
    findOnPath: async () => null,
    resolvePackageBin: async () => '/somewhere/bin/rcf-verify.js',
  });
  assert.equal(det.installed, true);
  assert.equal(det.invocation.command, process.execPath);
  assert.deepEqual(det.invocation.prefixArgs, ['/somewhere/bin/rcf-verify.js']);
});

test('detectVerify reports not-installed when neither route resolves', async () => {
  const det = await detectVerify({
    findOnPath: async () => null,
    resolvePackageBin: async () => null,
  });
  assert.equal(det.installed, false);
  assert.equal(det.invocation, null);
});

// --- resolveAbsentVerify: the §8.3 prompt-or-flag decision matrix ----------

test('resolveAbsentVerify installs on an explicit --install-verify flag (non-interactive)', async () => {
  let installed = false;
  const io = { stdout: sink(), stderr: sink() };
  const res = await resolveAbsentVerify({ installFlag: true, isTty: false }, io, {
    installVerify: async () => { installed = true; return 0; },
    promptYesNo: async () => { throw new Error('must not prompt with the flag'); },
  });
  assert.deepEqual(res, { action: 'installed' });
  assert.equal(installed, true);
});

test('resolveAbsentVerify installs after an affirmative TTY prompt', async () => {
  let prompted = false; let installed = false;
  const io = { stdout: sink(), stderr: sink() };
  const res = await resolveAbsentVerify({ installFlag: false, isTty: true }, io, {
    promptYesNo: async () => { prompted = true; return true; },
    installVerify: async () => { installed = true; return 0; },
  });
  assert.deepEqual(res, { action: 'installed' });
  assert.ok(prompted && installed);
});

test('resolveAbsentVerify ABORTS (never skips) when the TTY prompt is declined', async () => {
  let installed = false;
  const io = { stdout: sink(), stderr: sink() };
  const res = await resolveAbsentVerify({ installFlag: false, isTty: true }, io, {
    promptYesNo: async () => false,
    installVerify: async () => { installed = true; return 0; },
  });
  assert.equal(res.action, 'abort');
  assert.equal(res.code, 4);
  assert.equal(installed, false, 'declining must not install');
  assert.match(res.reason, new RegExp(VERIFY_PACKAGE.replace(/[/-]/g, '.')));
});

test('resolveAbsentVerify ABORTS (never silently skips/installs) off a TTY without the flag', async () => {
  let installed = false; let prompted = false;
  const io = { stdout: sink(), stderr: sink() };
  const res = await resolveAbsentVerify({ installFlag: false, isTty: false }, io, {
    promptYesNo: async () => { prompted = true; return true; },
    installVerify: async () => { installed = true; return 0; },
  });
  assert.equal(res.action, 'abort');
  assert.equal(res.code, 4);
  assert.equal(installed, false, 'no silent auto-install');
  assert.equal(prompted, false, 'cannot prompt without a TTY');
  assert.match(res.reason, /--install-verify/);
});

test('resolveAbsentVerify aborts when the install command fails', async () => {
  const io = { stdout: sink(), stderr: sink() };
  const res = await resolveAbsentVerify({ installFlag: true, isTty: false }, io, {
    installVerify: async () => 1,
  });
  assert.equal(res.action, 'abort');
  assert.equal(res.code, 1);
  assert.match(res.reason, /install.*failed/i);
});
