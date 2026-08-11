// Engine orchestrator tests (spec §5, §8.2, §11 point 1 — agent launcher
// STUBBED). Asserts the brief is composed from the chain, the isolation env is
// stamped, findings are validated/aggregated/stamped, and the profile gates
// (NOT-DEPLOYED / verdictAuthority) fire correctly. No live agent, no network.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isRcfError } from '@stravica-ai/rcf-lite-core/errors';
import { runVerification, normaliseFindings } from '../../src/engine/index.js';
import { gateTripped } from '../../src/verdict/index.js';
import { scaffoldChain, stubLauncher } from '../helpers/chain.js';

const FIXED_NOW = () => '2026-07-21T12:00:00.000Z';
const reachable = async () => ({ status: 200 });

const brokenFinding = { severity: 'BROKEN', acId: 'AC-101-1', journey: 'sign-in', reproSteps: ['open /login', 'submit valid creds', '500'], evidence: { kind: 'runtimeError', detail: 'auth 500' } };
const passFinding = { severity: 'PASS', acId: 'AC-101-3', journey: 'landing', reproSteps: ['load /'], evidence: { kind: 'note', detail: 'headline visible' } };

test('normaliseFindings: rejects a non-array and a malformed finding (no silent drop)', () => {
  assert.ok(isRcfError(normaliseFindings('nope')));
  assert.ok(isRcfError(normaliseFindings([{ severity: 'BROKEN' }]))); // missing acId etc.
});

test('runVerification: missing --profile is a usage error as data', async () => {
  const { root } = await scaffoldChain();
  const res = await runVerification({ repo: root, url: 'https://app' }, { now: FIXED_NOW });
  assert.ok(isRcfError(res));
  assert.equal(res.kind, 'usage');
});

test('runVerification: deployed + local URL -> NOT-DEPLOYED report, agent never launched', async () => {
  const { root } = await scaffoldChain();
  let launched = false;
  const res = await runVerification(
    { repo: root, profile: 'deployed', url: 'http://localhost:8787' },
    { now: FIXED_NOW, launchAgent: async () => { launched = true; return { findings: [] }; } },
  );
  assert.ok(!isRcfError(res));
  assert.equal(res.report.verdict, 'NOT-DEPLOYED');
  assert.equal(launched, false);
  assert.equal(res.report.verdictAuthority, 'ship'); // it was a ship-gate attempt
});

test('runVerification: ci + localhost + stub findings -> split-not-averaged BROKEN, correctness authority', async () => {
  const { root } = await scaffoldChain();
  const res = await runVerification(
    { repo: root, profile: 'ci', url: 'http://localhost:3000', provisionMode: 'skip' },
    { now: FIXED_NOW, launchAgent: stubLauncher([passFinding, brokenFinding]) },
  );
  assert.ok(!isRcfError(res));
  assert.equal(res.report.verdict, 'BROKEN'); // one broken among passes
  assert.equal(res.report.verdictAuthority, 'correctness');
  assert.equal(res.report.run.profile, 'ci');
  assert.equal(res.report.run.verifierIsolation.autoMemory, false);
  assert.equal(res.report.run.verifierIsolation.nonEssentialTraffic, false);
  assert.equal(res.report.findings.length, 2);
});

test('runVerification: --parity-env lifts a ci run to SHIP authority', async () => {
  const { root } = await scaffoldChain();
  const res = await runVerification(
    { repo: root, profile: 'ci', url: 'http://localhost:3000', parityEnv: true, provisionMode: 'skip' },
    { now: FIXED_NOW, launchAgent: stubLauncher([passFinding]) },
  );
  assert.equal(res.report.verdictAuthority, 'ship');
  assert.equal(res.report.run.parityEnv, true);
});

test('runVerification: deployed + reachable real URL -> verdict issued (faked fetch)', async () => {
  const { root } = await scaffoldChain();
  const res = await runVerification(
    { repo: root, profile: 'deployed', url: 'https://app.example.com', provisionMode: 'skip' },
    { now: FIXED_NOW, fetchImpl: reachable, launchAgent: stubLauncher([passFinding]) },
  );
  assert.ok(!isRcfError(res));
  assert.equal(res.report.verdict, 'PASS');
  assert.deepEqual(res.report.run.reachability, { reachable: true, looksLocal: false });
});

test('runVerification: a launcher that throws -> LAUNCH-FAILURE report, NEVER a fabricated PASS (§9, §5.4 --out-always-written)', async () => {
  const { root } = await scaffoldChain();
  const err = new Error('agent output could not be ingested');
  err.rawOutputPath = '/tmp/rcf-verify-agent-output-x.txt';
  const res = await runVerification(
    { repo: root, profile: 'ci', url: 'http://localhost:3000', provisionMode: 'skip' },
    { now: FIXED_NOW, launchAgent: async () => { throw err; } },
  );
  // The report is still built (build-lite's next input, §5.4) — not an RcfError.
  assert.ok(!isRcfError(res));
  assert.equal(res.report.verdict, 'LAUNCH-FAILURE');
  assert.equal(res.report.findings.length, 0); // no fabricated PASS
  assert.match(res.report.launchFailure.message, /could not be ingested/);
  assert.equal(res.report.launchFailure.rawOutputPath, '/tmp/rcf-verify-agent-output-x.txt');
  // LAUNCH-FAILURE trips the gate (ship cannot be confirmed).
  assert.equal(gateTripped({ verdict: res.report.verdict }), true);
});

test('runVerification: launcher runStats thread into the report (fix 5); absent -> null (omit-not-fake)', async () => {
  const { root } = await scaffoldChain();
  const withStats = await runVerification(
    { repo: root, profile: 'ci', url: 'http://localhost:3000', provisionMode: 'skip' },
    { now: FIXED_NOW, launchAgent: async () => ({ findings: [passFinding], runStats: { durationMs: 4200, tokens: { outputTokens: 99 } } }) },
  );
  assert.equal(withStats.report.run.runStats.durationMs, 4200);
  const noStats = await runVerification(
    { repo: root, profile: 'ci', url: 'http://localhost:3000', provisionMode: 'skip' },
    { now: FIXED_NOW, launchAgent: stubLauncher([passFinding]) },
  );
  assert.equal(noStats.report.run.runStats, null);
});

test('runVerification: unprovisionable prereqs surface as blockedAcs in the report (default run mode)', async () => {
  const { root } = await scaffoldChain();
  const res = await runVerification(
    { repo: root, profile: 'ci', url: 'http://localhost:3000' }, // provisionMode defaults to run; no signup route
    { now: FIXED_NOW, launchAgent: stubLauncher([passFinding]) },
  );
  assert.ok(!isRcfError(res));
  // AC-101-1 (auth) + AC-101-2 (payment) require prereqs with no route -> BLOCKED.
  const blockedIds = res.report.blockedAcs.map((b) => b.acId).sort();
  assert.deepEqual(blockedIds, ['AC-101-1', 'AC-101-2']);
  assert.ok(res.report.blockedAcs.every((b) => /cannot provision/.test(b.reason)));
});

test('runVerification: provisioning auth succeeds with an injected signup; cleanup reported', async () => {
  const { root } = await scaffoldChain();
  const removed = [];
  const res = await runVerification(
    { repo: root, profile: 'ci', url: 'http://localhost:3000' },
    {
      now: FIXED_NOW,
      launchAgent: stubLauncher([passFinding]),
      signup: async ({ username }) => ({ username, password: 'pw' }),
      teardown: async (ref) => { removed.push(ref); },
    },
  );
  assert.ok(!isRcfError(res));
  // Auth provisioned (>=2 accounts); payment still blocked.
  assert.ok(res.report.provisioning.provisioned.length >= 2);
  assert.equal(res.report.provisioning.cleanupRan, true);
  assert.ok(res.report.provisioning.cleanupRemoved.length >= 2);
  const blockedIds = res.report.blockedAcs.map((b) => b.acId);
  assert.deepEqual(blockedIds, ['AC-101-2']); // payment only
  // No secret leaked into the report body.
  assert.doesNotMatch(JSON.stringify(res.report), /"password":"pw"/);
});
