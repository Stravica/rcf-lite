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

// --- AC-16505-4: blocked-reason names an available remedy ------------------
