// Issue 356 (2026-10-13) finalise-side coverage, US-16505 / TS-250
// (AC-16505-1 .. AC-16505-4):
//   1. `rcf build finalise` accepts --provision-mode <run|skip> with the
//      verify command's semantics and forwards it verbatim to the fresh
//      verify subprocess (buildVerifyArgs threads it through); an unknown
//      value is a usage error before verify launches.
//   2. The finalise help text lists --provision-mode with both values and
//      the report.provisioning.mode disclosure.
//   3. The finalise report carries the same provisioning.mode stamp as a
//      direct verify run, on a completed run and on a launch failure, so
//      the audit trail records the operator's declaration whichever
//      command invoked the gate.
//   4. Every remedy flag named in a provisioning blocked-reason that
//      finalise surfaces is a flag finalise itself accepts (or the reason
//      names the verify-direct route). Before this train finalise printed
//      "re-run with `--provision-mode skip`" while rejecting that flag.
//
// The spawn seam runs the REAL `rcf verify run` CLI in-process against the
// fixture chain (no child process, no model), exactly as
// finalise-fbs-scope.test.js does, so the forwarded flag changes verify's
// provisioning behaviour end to end; the only stubs are the launcher and
// fetch. The fixture chain (test/verify/helpers/chain.js) carries an auth
// criterion with no signup route and a payment-sandbox criterion, both of
// which verify blocks under `run` and leaves alone under `skip`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { main as finalise, HELP as FINALISE_HELP } from '../../src/cli/finalise.js';
import { buildVerifyArgs } from '../../src/finalise/spawn.js';
import { main as verifyRun } from '../../src/verify/cli/run.js';
import { scaffoldChain } from '../verify/helpers/chain.js';

function sink() { return { data: '', write(s) { this.data += s; } }; }

const DETECTED = { installed: true, invocation: { command: 'node', prefixArgs: [] } };
const URL = 'https://app.example.com';

function fbsDoc(fbsId, buildOrder, acIds) {
  return {
    fbsId,
    prdId: 'PRD-001',
    bsId: 'BS-001',
    buildOrder,
    executionStatus: 'complete',
    title: `${fbsId} fixture`,
    summary: `${fbsId} binds ${acIds.join(', ')}.`,
    acIds,
    dependsOnFbsIds: [],
    createdAt: '2026-10-13T00:00:00.000Z',
    updatedAt: '2026-10-13T00:00:00.000Z',
  };
}

// The default fixture chain: AC-101-1 (sign-in, needs an auth account the
// app exposes no signup route for), AC-101-2 (checkout against a payment
// sandbox, out-of-band in v1), AC-101-3 (plain landing page). FBS-001
// binds the two provisioning-dependent criteria: under `run` both land on
// blockedAcs and the gate refuses; under `skip` neither is blocked and the
// stub launcher passes them, which is the issue 356 admin-seeded scenario.
async function scaffoldSeeded() {
  const { root } = await scaffoldChain({
    fbsItems: [fbsDoc('FBS-001', 1, ['AC-101-1', 'AC-101-2'])],
  });
  return root;
}

function passFinding(j) {
  return { severity: 'PASS', acId: j.acId, journey: j.journey, reproSteps: ['drive'], evidence: { kind: 'note', detail: 'ok' } };
}

// Runs the real verify CLI in-process with the argv finalise composed and
// records that argv on `calls`.
function inProcessVerify({ calls }) {
  return async ({ verifyArgs, cwd }) => {
    calls.push(verifyArgs);
    assert.deepEqual(verifyArgs.slice(0, 2), ['verify', 'run']);
    const code = await verifyRun(verifyArgs.slice(2), {
      cwd,
      stderr: sink(),
      stdout: sink(),
      fetchImpl: async () => ({ status: 200, text: async () => '<html>ok</html>' }),
      launchAgent: async ({ brief }) => ({ findings: brief.journeys.map(passFinding) }),
    });
    return { code, signal: null, env: {} };
  };
}

// A launcher that never writes the report and exits non-zero: the preseed
// stub becomes the aborted record (issue 330 partial-report fallback).
function launchFailure({ calls }) {
  return async ({ verifyArgs }) => {
    calls.push(verifyArgs);
    return { code: 1, signal: null, env: {} };
  };
}

async function statusOf(root, fbsId) {
  const doc = JSON.parse(await readFile(join(root, 'rcf', 'fbs', `${fbsId.toLowerCase()}.json`), 'utf8'));
  return doc.executionStatus;
}

async function readReport(root) {
  return JSON.parse(await readFile(join(root, '.rcf-verify-report.json'), 'utf8'));
}

function pairOf(args, flag) {
  const at = args.indexOf(flag);
  return at === -1 ? null : args.slice(at, at + 2);
}

// --- AC-16505-1: accepted and forwarded verbatim ---------------------------

test('buildVerifyArgs: --provision-mode threads through to the fresh subprocess argv exactly once; absent means no flag', () => {
  const base = { repo: '/r', url: URL, profile: 'deployed', out: '/r/.rcf-verify-report.json', severityGate: 'BROKEN' };
  const skip = buildVerifyArgs({ ...base, provisionMode: 'skip' });
  assert.deepEqual(pairOf(skip, '--provision-mode'), ['--provision-mode', 'skip']);
  assert.equal(skip.filter((a) => a === '--provision-mode').length, 1);
  const run = buildVerifyArgs({ ...base, provisionMode: 'run' });
  assert.deepEqual(pairOf(run, '--provision-mode'), ['--provision-mode', 'run']);
  // Gate P2 (fix round): the exact-once count holds for run as it does
  // for skip; a value-specific duplicate pair would violate AC-16505-1.
  assert.equal(run.filter((a) => a === '--provision-mode').length, 1);
  // The issue 356 shape: the mode travels next to the other forwarded
  // optionals and does not disturb the required §8.2 prefix.
  assert.deepEqual(skip.slice(0, 11), buildVerifyArgs(base).slice(0, 11));
  const absent = buildVerifyArgs(base);
  assert.ok(!absent.includes('--provision-mode'), 'no provisionMode -> no flag; verify applies its own default');
  const undef = buildVerifyArgs({ ...base, provisionMode: undefined });
  assert.ok(!undef.includes('--provision-mode'));
});

test('finalise: accepts --provision-mode run|skip and forwards it to the verify subprocess; an unknown value is a usage error (exit 2)', async () => {
  // skip: accepted, forwarded as the adjacent pair, exactly once.
  const root = await scaffoldSeeded();
  const calls = [];
  const stderr = sink();
  const code = await finalise(['FBS-001', '--url', URL, '--allow-pre-merge', '--provision-mode', 'skip'], {
    stdout: sink(), stderr, cwd: root,
    detectVerify: async () => DETECTED,
    spawnVerify: launchFailure({ calls }),
  });
  assert.doesNotMatch(stderr.data, /unknown option '--provision-mode'/, 'finalise must accept --provision-mode');
  assert.notEqual(code, 2, `finalise refused the flag as a usage error:\n${stderr.data}`);
  assert.equal(calls.length, 1, 'verify launches exactly once');
  assert.deepEqual(pairOf(calls[0], '--provision-mode'), ['--provision-mode', 'skip']);
  assert.equal(calls[0].filter((a) => a === '--provision-mode').length, 1);

  // run: accepted and forwarded verbatim, exactly once.
  const calls2 = [];
  const stderr2 = sink();
  const code2 = await finalise(['FBS-001', '--url', URL, '--allow-pre-merge', '--provision-mode', 'run'], {
    stdout: sink(), stderr: stderr2, cwd: root,
    detectVerify: async () => DETECTED,
    spawnVerify: launchFailure({ calls: calls2 }),
  });
  assert.notEqual(code2, 2, stderr2.data);
  assert.equal(calls2.length, 1, 'verify launches exactly once');
  assert.deepEqual(pairOf(calls2[0], '--provision-mode'), ['--provision-mode', 'run']);
  // Gate P2 (fix round): exactly one token for run in the captured argv,
  // the same count the skip branch above pins.
  assert.equal(calls2[0].filter((a) => a === '--provision-mode').length, 1);

  // absent: nothing forwarded; verify's own default applies.
  const calls3 = [];
  await finalise(['FBS-001', '--url', URL, '--allow-pre-merge'], {
    stdout: sink(), stderr: sink(), cwd: root,
    detectVerify: async () => DETECTED,
    spawnVerify: launchFailure({ calls: calls3 }),
  });
  assert.equal(calls3.length, 1);
  assert.ok(!calls3[0].includes('--provision-mode'));

  // unknown value: usage error, nothing launched, FBS untouched. Mirrors
  // verify run's own message so the two commands teach the same thing.
  const calls4 = [];
  const stderr4 = sink();
  const code4 = await finalise(['FBS-001', '--url', URL, '--allow-pre-merge', '--provision-mode', 'foo'], {
    stdout: sink(), stderr: stderr4, cwd: root,
    detectVerify: async () => DETECTED,
    spawnVerify: launchFailure({ calls: calls4 }),
  });
  assert.equal(code4, 2);
  assert.equal(calls4.length, 0, 'verify must not launch on a bad --provision-mode');
  assert.match(stderr4.data, /--provision-mode must be run \| skip/);
  assert.equal(await statusOf(root, 'FBS-001'), 'complete');
});

// --- AC-16505-2: help text ---------------------------------------------------

test('finalise help lists --provision-mode with run and skip and the report.provisioning.mode disclosure', async () => {
  const optionsBlock = FINALISE_HELP.slice(FINALISE_HELP.indexOf('Options:'), FINALISE_HELP.indexOf('Exit codes:'));
  assert.match(optionsBlock, /^ {2}--provision-mode <m>\s+/m, 'the Options block lists --provision-mode <m>');
  // The entry runs from its own line to the next option line.
  const entry = optionsBlock.slice(optionsBlock.indexOf('  --provision-mode'));
  const nextOption = entry.search(/\n {2}--/);
  const entryBody = nextOption === -1 ? entry : entry.slice(0, nextOption);
  assert.match(entryBody, /\brun\b/);
  assert.match(entryBody, /\bskip\b/);
  assert.match(entryBody, /out of band/);
  assert.match(entryBody, /report\.provisioning\.mode/);
  assert.doesNotMatch(FINALISE_HELP, /\u2014/, 'no em-dash in the finalise help');
  // The rendered --help goes through the same string.
  const stdout = sink();
  const code = await finalise(['--help'], { stdout, stderr: sink() });
  assert.equal(code, 0);
  assert.match(stdout.data, /--provision-mode <m>/);
});

// --- AC-16505-3: the report stamps provisioning.mode -----------------------

test('finalise: the report stamps provisioning.mode on a completed run (skip promotes, run blocks) and on a launch failure', async () => {
  // Completed run under skip: the admin-seeded chain promotes through
  // finalise exactly as it does through `rcf verify run --provision-mode
  // skip`, and the report records the declaration.
  const root = await scaffoldSeeded();
  const stdout = sink();
  const stderr = sink();
  const code = await finalise(['FBS-001', '--url', URL, '--allow-pre-merge', '--provision-mode', 'skip'], {
    stdout, stderr, cwd: root,
    detectVerify: async () => DETECTED,
    spawnVerify: inProcessVerify({ calls: [] }),
  });
  assert.equal(code, 0, stderr.data);
  const report = await readReport(root);
  assert.equal(report.provisioning?.mode, 'skip');
  assert.equal(report.verdict, 'PASS');
  assert.equal(report.verdictAuthority, 'ship');
  assert.deepEqual(report.blockedAcs, []);
  assert.equal(await statusOf(root, 'FBS-001'), 'verified');
  assert.match(stdout.data, /marked FBS-001 complete -> verified/);

  // No flag: verify's default `run` is stamped, the two provisioning-
  // dependent criteria are blocked, and the gate refuses (ADR-4112).
  const root2 = await scaffoldSeeded();
  const stderr2 = sink();
  const code2 = await finalise(['FBS-001', '--url', URL, '--allow-pre-merge'], {
    stdout: sink(), stderr: stderr2, cwd: root2,
    detectVerify: async () => DETECTED,
    spawnVerify: inProcessVerify({ calls: [] }),
  });
  assert.equal(code2, 4);
  const report2 = await readReport(root2);
  assert.equal(report2.provisioning?.mode, 'run');
  assert.deepEqual(report2.blockedAcs.map((b) => b.acId), ['AC-101-1', 'AC-101-2']);
  assert.equal(await statusOf(root2, 'FBS-001'), 'complete');
  assert.match(stderr2.data, /2 AC\(s\) in scope fbs:FBS-001 were not exercised \(AC-101-1, AC-101-2\)/);

  // Launch failure under skip: verify never wrote a report, so the
  // aborted record finalise leaves behind must still carry the operator's
  // declaration; otherwise the audit trail of a failed finalise cannot
  // tell a skipped run from a provisioned one.
  const root3 = await scaffoldSeeded();
  const stderr3 = sink();
  const code3 = await finalise(['FBS-001', '--url', URL, '--allow-pre-merge', '--provision-mode', 'skip'], {
    stdout: sink(), stderr: stderr3, cwd: root3,
    detectVerify: async () => DETECTED,
    spawnVerify: launchFailure({ calls: [] }),
  });
  assert.notEqual(code3, 0);
  assert.notEqual(code3, 2, stderr3.data);
  const report3 = await readReport(root3);
  assert.equal(report3.launchFailure?.status, 'aborted');
  assert.equal(report3.provisioning?.mode, 'skip');
  assert.equal(await statusOf(root3, 'FBS-001'), 'complete');
});

// --- AC-16505-4: blocked-reason names an available remedy ------------------

test('finalise: a provisioning blocked-reason names only remedies finalise itself exposes', async () => {
  // FBS-002 binds the payment-sandbox criterion only: under the default
  // provisioning mode verify blocks it with the serviceSandbox reason.
  const { root } = await scaffoldChain({ fbsItems: [fbsDoc('FBS-002', 2, ['AC-101-2'])] });
  const stderr = sink();
  const code = await finalise(['FBS-002', '--url', URL, '--allow-pre-merge'], {
    stdout: sink(), stderr, cwd: root,
    detectVerify: async () => DETECTED,
    spawnVerify: inProcessVerify({ calls: [] }),
  });
  assert.equal(code, 4);
  assert.equal(await statusOf(root, 'FBS-002'), 'complete');
  const reasonLines = stderr.data.split('\n').filter((l) => /^ {2}- AC-101-2: /.test(l));
  assert.equal(reasonLines.length, 1, `finalise surfaces the blocked reason for AC-101-2:\n${stderr.data}`);
  const reason = reasonLines[0];
  assert.match(reason, /cannot provision: serviceSandbox/);

  // Every remedy flag the reason names must be a finalise flag (listed in
  // the help, accepted by the parser), unless the reason routes the
  // operator to `rcf verify run` directly.
  const flags = [...new Set(reason.match(/--[a-z][a-z0-9-]*/g) ?? [])];
  const namesDirectRoute = /rcf verify run/.test(reason);
  assert.ok(flags.length > 0 || namesDirectRoute, `the reason names a remedy (a flag or the verify-direct route):\n${reason}`);
  for (const flag of flags) {
    if (namesDirectRoute) continue;
    assert.match(FINALISE_HELP, new RegExp(`^ {2}${flag}\\b`, 'm'), `remedy ${flag} named in the blocked reason is listed in finalise help`);
    const stderr2 = sink();
    await finalise(['FBS-002', '--url', URL, '--allow-pre-merge', flag, 'skip'], {
      stdout: sink(), stderr: stderr2, cwd: root,
      detectVerify: async () => DETECTED,
      spawnVerify: async () => ({ code: 1, signal: null, env: {} }),
    });
    assert.doesNotMatch(stderr2.data, new RegExp(`unknown option '${flag}'`), `remedy ${flag} named in the blocked reason is accepted by finalise`);
  }
  // The issue 356 wording in particular: a finalise that prints "re-run
  // with `--provision-mode skip`" must accept --provision-mode.
  if (/--provision-mode skip/.test(reason)) {
    assert.match(FINALISE_HELP, /^ {2}--provision-mode <m>/m);
  }

  // And the remedy works: re-running finalise with it promotes.
  const stderr3 = sink();
  const code3 = await finalise(['FBS-002', '--url', URL, '--allow-pre-merge', '--provision-mode', 'skip'], {
    stdout: sink(), stderr: stderr3, cwd: root,
    detectVerify: async () => DETECTED,
    spawnVerify: inProcessVerify({ calls: [] }),
  });
  assert.equal(code3, 0, stderr3.data);
  assert.equal(await statusOf(root, 'FBS-002'), 'verified');
});
