// ADR-4147 / US-16504 finalise-side coverage (AC-16504-2, -3, -4):
//   1. finalise passes its own FBS as the verify filter by default and
//      the verifier is briefed on exactly that FBS's bound ACs;
//   2. --all passes no filter and the whole chain is verified;
//   3. the ADR-4112 verified invariant is evaluated over the scoped set:
//      a skipped (blocked) AC inside the scope refuses promotion, one
//      outside the scope does not;
//   4. an FBS with zero bound ACs is refused before verify launches;
//   5. the finalise output and the report render state the scope;
//   6. the help text and the finalise docs page describe the scope.
//
// The spawn seam runs the REAL `rcf verify run` CLI in-process against
// the fixture chain (no child process, no model) so the filter is
// exercised end to end; the only stubs are the launcher and fetch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { main as finalise, HELP as FINALISE_HELP } from '../../src/cli/finalise.js';
import { buildVerifyArgs } from '../../src/finalise/spawn.js';
import { summariseReport } from '../../src/finalise/ingest.js';
import { main as verifyRun, HELP as VERIFY_RUN_HELP } from '../../src/verify/cli/run.js';
import { renderReport } from '../../src/verify/report/renderer.js';
import { scaffoldChain } from '../verify/helpers/chain.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

function sink() { return { data: '', write(s) { this.data += s; } }; }

const DETECTED = { installed: true, invocation: { command: 'node', prefixArgs: [] } };

function fbsDoc(fbsId, buildOrder, acIds) {
  return {
    fbsId,
    prdId: 'PRD-001',
    bsId: 'BS-001',
    buildOrder,
    executionStatus: 'complete',
    title: `${fbsId} fixture`,
    summary: `${fbsId} binds ${acIds.join(', ') || 'nothing'}.`,
    acIds,
    dependsOnFbsIds: [],
    createdAt: '2026-10-12T00:00:00.000Z',
    updatedAt: '2026-10-12T00:00:00.000Z',
  };
}

// FBS-001 binds the plain landing-page AC (AC-101-3), which the stub
// launcher can pass. FBS-002 binds the sign-in AC (AC-101-1), which
// needs a provisioned account; with no signup route it lands on
// blockedAcs (skipped), so any run that has AC-101-1 in scope carries
// a skipped AC and finalise refuses promotion (ADR-4112 over the scope).
async function scaffoldTwoFbs() {
  const { root } = await scaffoldChain({
    acceptanceCriteria: [
      {
        id: 'AC-101-1',
        description: 'A user can sign in with valid credentials',
        given: 'a registered account exists',
        when: 'the user submits the sign-in form with valid credentials',
        then: 'the user reaches their authenticated dashboard',
        testable: true,
      },
      {
        id: 'AC-101-3',
        description: 'The landing page renders a headline',
        given: 'the app is reachable',
        when: 'a visitor loads the landing page',
        then: 'a headline is visible above the fold',
        testable: true,
      },
    ],
    fbsItems: [
      fbsDoc('FBS-001', 1, ['AC-101-3']),
      fbsDoc('FBS-002', 2, ['AC-101-1']),
    ],
  });
  return root;
}

// FBS-003 binds two plain ACs (AC-101-3 and AC-101-4) that the stub
// launcher can pass, so a launcher that answers for one of them leaves
// the other unexercised inside the scope. FBS-004 binds AC-101-4 only.
async function scaffoldPairFbs() {
  const { root } = await scaffoldChain({
    acceptanceCriteria: [
      {
        id: 'AC-101-3',
        description: 'The landing page renders a headline',
        given: 'the app is reachable',
        when: 'a visitor loads the landing page',
        then: 'a headline is visible above the fold',
        testable: true,
      },
      {
        id: 'AC-101-4',
        description: 'The landing page renders a footer',
        given: 'the app is reachable',
        when: 'a visitor scrolls to the end of the landing page',
        then: 'a footer with the product name is visible',
        testable: true,
      },
    ],
    fbsItems: [
      // The seeded FBS-001 binds AC-101-1, which this chain does not carry.
      fbsDoc('FBS-001', 1, ['AC-101-3']),
      fbsDoc('FBS-003', 3, ['AC-101-3', 'AC-101-4']),
      fbsDoc('FBS-004', 4, ['AC-101-4']),
    ],
  });
  return root;
}

function passFinding(j) {
  return { severity: 'PASS', acId: j.acId, journey: j.journey, reproSteps: ['drive'], evidence: { kind: 'note', detail: 'ok' } };
}

// Runs the real verify CLI in-process with the argv finalise composed.
// `respond` maps the brief to the findings the stub launcher returns; the
// default passes every journey in the brief.
function inProcessVerify({ seen, calls, respond }) {
  return async ({ verifyArgs, cwd }) => {
    calls.push(verifyArgs);
    assert.deepEqual(verifyArgs.slice(0, 2), ['verify', 'run']);
    const code = await verifyRun(verifyArgs.slice(2), {
      cwd,
      stderr: sink(),
      stdout: sink(),
      // deployed-profile reachability probe: something is listening.
      fetchImpl: async () => ({ status: 200, text: async () => '<html>ok</html>' }),
      launchAgent: async ({ brief }) => {
        for (const j of brief.journeys) seen.push(j.acId);
        return { findings: respond ? respond(brief) : brief.journeys.map(passFinding) };
      },
    });
    return { code, signal: null, env: {} };
  };
}

async function statusOf(root, fbsId) {
  const doc = JSON.parse(await readFile(join(root, 'rcf', 'fbs', `${fbsId.toLowerCase()}.json`), 'utf8'));
  return doc.executionStatus;
}

test('buildVerifyArgs: fbsIds become one --fbs <id> per entry; absent means no filter', () => {
  const base = { repo: '/r', url: 'https://app', profile: 'deployed', out: '/r/report.json', severityGate: 'BROKEN' };
  const scoped = buildVerifyArgs({ ...base, fbsIds: ['FBS-001'] });
  assert.deepEqual(scoped.slice(scoped.indexOf('--fbs')), ['--fbs', 'FBS-001']);
  const two = buildVerifyArgs({ ...base, fbsIds: ['FBS-001', 'FBS-002'] });
  assert.equal(two.filter((a) => a === '--fbs').length, 2);
  const none = buildVerifyArgs({ ...base, fbsIds: [] });
  assert.ok(!none.includes('--fbs'));
  const absent = buildVerifyArgs(base);
  assert.ok(!absent.includes('--fbs'));
});

test('finalise: passes its own FBS as the verify filter by default; --all passes no filter', async () => {
  const root = await scaffoldTwoFbs();

  // Default: the subprocess argv carries --fbs FBS-001 and the verifier
  // is briefed on FBS-001's one bound AC only (the chain has two).
  const seen = [];
  const calls = [];
  const stdout = sink();
  const stderr = sink();
  const code = await finalise(['FBS-001', '--url', 'https://app.example.com', '--allow-pre-merge'], {
    stdout, stderr, cwd: root,
    detectVerify: async () => DETECTED,
    spawnVerify: inProcessVerify({ seen, calls }),
  });
  assert.equal(code, 0, stderr.data);
  assert.deepEqual(calls[0].slice(calls[0].indexOf('--fbs')), ['--fbs', 'FBS-001']);
  assert.deepEqual(seen, ['AC-101-3']);
  assert.equal(await statusOf(root, 'FBS-001'), 'verified');
  assert.match(stdout.data, /scope=fbs:FBS-001 \(1 ACs\)/);
  assert.match(stdout.data, /marked FBS-001 complete -> verified \(scope fbs:FBS-001, 1 ACs\)/);
  const report = JSON.parse(await readFile(join(root, '.rcf-verify-report.json'), 'utf8'));
  assert.equal(report.run.scope, 'fbs:FBS-001');
  assert.equal(report.run.scopeAcCount, 1);

  // --all: no --fbs on the argv, the verifier is briefed on the whole
  // chain, and the whole chain (AC-101-1 blocked) decides the gate.
  const root2 = await scaffoldTwoFbs();
  const seen2 = [];
  const calls2 = [];
  const stdout2 = sink();
  const stderr2 = sink();
  const code2 = await finalise(['FBS-001', '--url', 'https://app.example.com', '--allow-pre-merge', '--all'], {
    stdout: stdout2, stderr: stderr2, cwd: root2,
    detectVerify: async () => DETECTED,
    spawnVerify: inProcessVerify({ seen: seen2, calls: calls2 }),
  });
  assert.ok(!calls2[0].includes('--fbs'));
  assert.deepEqual(seen2, ['AC-101-1', 'AC-101-3']);
  assert.match(stdout2.data, /--all: verifying the whole chain \(2 ACs\), not only the 1 bound to FBS-001/);
  assert.match(stdout2.data, /scope=chain \(2 ACs\)/);
  // AC-101-1 is skipped (no signup route to provision an account), so
  // the whole-chain run carries a blocked AC and FBS-001 is not promoted.
  assert.equal(code2, 4);
  assert.equal(await statusOf(root2, 'FBS-001'), 'complete');
  const report2 = JSON.parse(await readFile(join(root2, '.rcf-verify-report.json'), 'utf8'));
  assert.equal(report2.run.scope, 'chain');
  assert.deepEqual(report2.blockedAcs.map((b) => b.acId), ['AC-101-1']);
  assert.match(stderr2.data, /1 AC\(s\) in scope chain were not exercised \(AC-101-1\)/);
  assert.match(stderr2.data, /ADR-4112/);
});

test('finalise: the verified invariant is evaluated over the scoped set (skipped AC in scope refuses, skipped AC outside scope does not, zero-AC FBS refused)', async () => {
  const root = await scaffoldTwoFbs();

  // FBS-002's scope contains AC-101-1, which the verifier cannot
  // exercise (blocked): refused, left at complete.
  const stderr = sink();
  const code = await finalise(['FBS-002', '--url', 'https://app.example.com', '--allow-pre-merge'], {
    stdout: sink(), stderr, cwd: root,
    detectVerify: async () => DETECTED,
    spawnVerify: inProcessVerify({ seen: [], calls: [] }),
  });
  assert.equal(code, 4);
  assert.equal(await statusOf(root, 'FBS-002'), 'complete');
  assert.match(stderr.data, /gate NOT promoted: 1 AC\(s\) in scope fbs:FBS-002 were not exercised \(AC-101-1\)/);
  assert.match(stderr.data, /ADR-4112/);
  assert.match(stderr.data, /scope: fbs:FBS-002 \(1 ACs\)/);
  assert.match(stderr.data, /blocked ACs \(1\)/);

  // FBS-001's scope does not contain the blocked AC-101-1: the same
  // chain, the same verifier, and FBS-001 is promoted.
  const stderr2 = sink();
  const code2 = await finalise(['FBS-001', '--url', 'https://app.example.com', '--allow-pre-merge'], {
    stdout: sink(), stderr: stderr2, cwd: root,
    detectVerify: async () => DETECTED,
    spawnVerify: inProcessVerify({ seen: [], calls: [] }),
  });
  assert.equal(code2, 0, stderr2.data);
  assert.equal(await statusOf(root, 'FBS-001'), 'verified');

  // Deterministic counts are scoped too: a deterministic run over
  // FBS-001 reports 1 of 1 skipped, and the refusal names the scope.
  const stderr3 = sink();
  const code3 = await finalise(['FBS-001', '--url', 'https://app.example.com', '--allow-pre-merge', '--mode', 'deterministic'], {
    stdout: sink(), stderr: stderr3, cwd: root,
    detectVerify: async () => DETECTED,
    spawnVerify: inProcessVerify({ seen: [], calls: [] }),
  });
  assert.equal(code3, 4);
  const report3 = JSON.parse(await readFile(join(root, '.rcf-verify-report.json'), 'utf8'));
  assert.equal(report3.run.runStats.mode, 'deterministic');
  // FBS-218 adds counts.critiqueOnly; the exact buckets are pinned by
  // test/verify/probe-catalog.test.js.
  assert.equal(report3.run.runStats.counts.total, 1);
  assert.equal(report3.run.runStats.counts.verified, 0);
  assert.equal(report3.run.runStats.counts.failed, 0);
  assert.equal(report3.run.scope, 'fbs:FBS-001');

  // Zero bound ACs: the schema refuses an empty acIds list, so the tree
  // does not load (exit 3); finalise names the FBS plainly instead of
  // echoing the schema message, and no verify run launches, --all or not.
  const fbsPath = join(root, 'rcf', 'fbs', 'fbs-003.json');
  await writeFile(fbsPath, `${JSON.stringify(fbsDoc('FBS-003', 3, []), null, 2)}\n`, 'utf8');
  for (const extra of [[], ['--all']]) {
    const calls = [];
    const stderr4 = sink();
    const code4 = await finalise(['FBS-003', '--url', 'https://app.example.com', '--allow-pre-merge', ...extra], {
      stdout: sink(), stderr: stderr4, cwd: root,
      detectVerify: async () => DETECTED,
      spawnVerify: inProcessVerify({ seen: [], calls }),
    });
    assert.equal(code4, 3);
    assert.equal(calls.length, 0, 'verify must not launch for a zero-AC FBS');
    assert.match(stderr4.data, /refused finalise: FBS-003 has no bound acceptance criteria; there is nothing to verify/);
    assert.equal(await statusOf(root, 'FBS-003'), 'complete');
  }
});

test('finalise: an agent result missing one scoped AC refuses promotion (noFinding); an extra out-of-scope finding does not change the verdict', async () => {
  const root = await scaffoldPairFbs();

  // The launcher answers for AC-101-3 only. AC-101-4 is in FBS-003's
  // scope with no finding, so verify records it as blocked (noFinding)
  // and finalise refuses; the FBS stays complete.
  const stderr = sink();
  const code = await finalise(['FBS-003', '--url', 'https://app.example.com', '--allow-pre-merge'], {
    stdout: sink(), stderr, cwd: root,
    detectVerify: async () => DETECTED,
    spawnVerify: inProcessVerify({
      seen: [], calls: [],
      respond: (brief) => brief.journeys.filter((j) => j.acId === 'AC-101-3').map(passFinding),
    }),
  });
  assert.equal(code, 4);
  assert.equal(await statusOf(root, 'FBS-003'), 'complete');
  assert.match(stderr.data, /gate NOT promoted: 1 AC\(s\) in scope fbs:FBS-003 were not exercised \(AC-101-4\)/);
  assert.match(stderr.data, /AC-101-4: noFinding:/);
  assert.match(stderr.data, /ADR-4112/);
  const report = JSON.parse(await readFile(join(root, '.rcf-verify-report.json'), 'utf8'));
  assert.equal(report.verdict, 'PASS');
  assert.deepEqual(report.blockedAcs.map((b) => b.acId), ['AC-101-4']);
  assert.deepEqual(report.run.runStats.coverage.missing, ['AC-101-4']);

  // The launcher answers for every scoped AC and adds a BROKEN finding
  // for an AC outside FBS-004's scope. The extra finding is ignored and
  // noted; the verdict is PASS and FBS-004 is promoted.
  const stdout2 = sink();
  const stderr2 = sink();
  const code2 = await finalise(['FBS-004', '--url', 'https://app.example.com', '--allow-pre-merge'], {
    stdout: stdout2, stderr: stderr2, cwd: root,
    detectVerify: async () => DETECTED,
    spawnVerify: inProcessVerify({
      seen: [], calls: [],
      respond: (brief) => [
        ...brief.journeys.map(passFinding),
        { severity: 'BROKEN', acId: 'AC-101-3', journey: 'landing', reproSteps: ['load /'], evidence: { kind: 'note', detail: 'outside the scope' } },
      ],
    }),
  });
  assert.equal(code2, 0, stderr2.data);
  assert.equal(await statusOf(root, 'FBS-004'), 'verified');
  const report2 = JSON.parse(await readFile(join(root, '.rcf-verify-report.json'), 'utf8'));
  assert.equal(report2.verdict, 'PASS');
  assert.deepEqual(report2.findings.map((f) => f.acId), ['AC-101-4']);
  assert.deepEqual(report2.blockedAcs, []);
  assert.deepEqual(report2.run.runStats.coverage.ignored, [{ acId: 'AC-101-3', severity: 'BROKEN' }]);
  assert.match(summariseReport(report2), /ignored findings outside scope \(1\):\n {2}- AC-101-3: BROKEN/);
});

async function markVerified(root, fbsId) {
  const fbsPath = join(root, 'rcf', 'fbs', `${fbsId.toLowerCase()}.json`);
  const doc = JSON.parse(await readFile(fbsPath, 'utf8'));
  doc.executionStatus = 'verified';
  await writeFile(fbsPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
}

test('finalise: re-verify of a verified FBS runs the report checks before confirming (a skipped AC in scope is refused, correctness authority holds, a clean run confirms)', async () => {
  const root = await scaffoldPairFbs();
  await markVerified(root, 'FBS-003');
  assert.equal(await statusOf(root, 'FBS-003'), 'verified');

  // Scoped run skips AC-101-4 (no finding) while AC-101-3 passes: verify
  // exits 0 with a PASS verdict, and finalise refuses rather than
  // printing gate passed. The status is not rewritten.
  const stdout = sink();
  const stderr = sink();
  const code = await finalise(['FBS-003', '--url', 'https://app.example.com', '--allow-pre-merge'], {
    stdout, stderr, cwd: root,
    detectVerify: async () => DETECTED,
    spawnVerify: inProcessVerify({
      seen: [], calls: [],
      respond: (brief) => brief.journeys.filter((j) => j.acId === 'AC-101-3').map(passFinding),
    }),
  });
  assert.equal(code, 4);
  assert.doesNotMatch(stdout.data, /gate passed/);
  assert.match(stderr.data, /gate NOT promoted: 1 AC\(s\) in scope fbs:FBS-003 were not exercised \(AC-101-4\); FBS-003 left 'verified'/);
  assert.match(stderr.data, /ADR-4112/);
  assert.equal(await statusOf(root, 'FBS-003'), 'verified');

  // A re-verify under a profile without ship authority holds, exactly as
  // a first promotion would.
  const stdout2 = sink();
  const stderr2 = sink();
  const code2 = await finalise(['FBS-003', '--url', 'http://localhost:3000', '--profile', 'ci', '--allow-pre-merge'], {
    stdout: stdout2, stderr: stderr2, cwd: root,
    detectVerify: async () => DETECTED,
    spawnVerify: inProcessVerify({ seen: [], calls: [] }),
  });
  assert.equal(code2, 4);
  assert.doesNotMatch(stdout2.data, /gate passed/);
  assert.match(stderr2.data, /HOLD: rcf verify passed but this run carries 'correctness' authority/);

  // A clean scoped run confirms the status with the re-verify line and
  // writes nothing.
  const stdout3 = sink();
  const stderr3 = sink();
  const code3 = await finalise(['FBS-003', '--url', 'https://app.example.com', '--allow-pre-merge'], {
    stdout: stdout3, stderr: stderr3, cwd: root,
    detectVerify: async () => DETECTED,
    spawnVerify: inProcessVerify({ seen: [], calls: [] }),
  });
  assert.equal(code3, 0, stderr3.data);
  assert.match(stdout3.data, /gate passed; FBS-003 already verified \(re-verify, scope fbs:FBS-003, 2 ACs\)/);
  assert.equal(await statusOf(root, 'FBS-003'), 'verified');

  // The same refusal when the skipped AC comes from provisioning rather
  // than a missing finding: FBS-005 binds the sign-in AC (blocked, no
  // signup route) together with the landing AC (PASS).
  const root2 = await scaffoldTwoFbs();
  await writeFile(join(root2, 'rcf', 'fbs', 'fbs-005.json'), `${JSON.stringify(fbsDoc('FBS-005', 5, ['AC-101-1', 'AC-101-3']), null, 2)}\n`, 'utf8');
  await markVerified(root2, 'FBS-005');
  const stdout4 = sink();
  const stderr4 = sink();
  const code4 = await finalise(['FBS-005', '--url', 'https://app.example.com', '--allow-pre-merge'], {
    stdout: stdout4, stderr: stderr4, cwd: root2,
    detectVerify: async () => DETECTED,
    spawnVerify: inProcessVerify({ seen: [], calls: [] }),
  });
  assert.equal(code4, 4);
  assert.doesNotMatch(stdout4.data, /gate passed/);
  const report4 = JSON.parse(await readFile(join(root2, '.rcf-verify-report.json'), 'utf8'));
  assert.equal(report4.verdict, 'PASS');
  assert.deepEqual(report4.blockedAcs.map((b) => b.acId), ['AC-101-1']);
  assert.match(stderr4.data, /1 AC\(s\) in scope fbs:FBS-005 were not exercised \(AC-101-1\); FBS-005 left 'verified'/);
  assert.equal(await statusOf(root2, 'FBS-005'), 'verified');
});

test('finalise: a deterministic report with skipped ACs in scope is refused with the counts line naming the scope', async () => {
  const root = await scaffoldTwoFbs();
  const report = {
    schemaVersion: '1',
    verdict: 'PASS',
    verdictAuthority: 'ship',
    run: {
      profile: 'deployed', url: 'https://app.example.com', scope: 'fbs:FBS-001', scopeAcCount: 1,
      runStats: { mode: 'deterministic', counts: { total: 1, verified: 0, failed: 0, skipped: 1 } },
    },
    findings: [],
    blockedAcs: [{ acId: 'AC-101-3', reason: 'critique-only', mode: 'deterministic' }],
  };
  const stderr = sink();
  const code = await finalise(['FBS-001', '--url', 'https://app.example.com', '--allow-pre-merge', '--mode', 'deterministic'], {
    stdout: sink(), stderr, cwd: root,
    detectVerify: async () => DETECTED,
    spawnVerify: async ({ verifyArgs }) => {
      await writeFile(verifyArgs[verifyArgs.indexOf('--out') + 1], JSON.stringify(report), 'utf8');
      return { code: 0, signal: null, env: {} };
    },
  });
  assert.equal(code, 4);
  assert.match(stderr.data, /deterministic mode verified 0 of 1 ACs in scope fbs:FBS-001/);
  assert.match(stderr.data, /ADR-4112/);
});

test('report render and finalise summary show the scope', () => {
  const report = {
    schemaVersion: '1', verdict: 'PASS', verdictAuthority: 'ship',
    run: { profile: 'deployed', url: 'https://app', parityEnv: false, scope: 'fbs:FBS-001,FBS-002', scopeAcCount: 5 },
    findings: [], blockedAcs: [],
  };
  assert.match(renderReport(report), /scope: {5}fbs:FBS-001,FBS-002 \(5 ACs\)/);
  assert.match(summariseReport(report), /scope: fbs:FBS-001,FBS-002 \(5 ACs\)/);
  // A pre-scope report (no run.scope) renders as chain and the summary
  // stays silent rather than inventing a scope.
  const older = { ...report, run: { profile: 'deployed', url: 'https://app' } };
  assert.match(renderReport(older), /scope: {5}chain\n/);
  assert.doesNotMatch(summariseReport(older), /scope:/);
});

test('finalise and verify run help, the report render and the finalise docs page describe the verification scope', async () => {
  // finalise help: default scope, --all, and the zero-AC refusal.
  assert.match(FINALISE_HELP, /by default the verify run covers only the acceptance criteria\nbound to <fbs-id>/);
  assert.match(FINALISE_HELP, /--all\s+Verify the whole chain/);
  assert.match(FINALISE_HELP, /no bound criteria is refused before verify launches/);
  // verify run help: --fbs and the recorded scope.
  assert.match(VERIFY_RUN_HELP, /--fbs <fbs-id>\s+Verify only the acceptance criteria bound to this\s+FBS/);
  assert.match(VERIFY_RUN_HELP, /run\.scope \('chain' or 'fbs:<ids>'\)/);
  // the docs page carries a Verification scope section that states the
  // default, the --all escape and the report fields.
  const docs = await readFile(resolve(repoRoot, 'docs', 'verify-reference.md'), 'utf8');
  assert.match(docs, /^## Verification scope$/m);
  assert.match(docs, /passes its own FBS as the filter by default/);
  assert.match(docs, /Pass `--all` to verify the whole chain instead/);
  assert.match(docs, /`run\.scope` is `chain` \(no filter\) or `fbs:<id>\[,<id>\.\.\.\]`/);
  // no em-dashes on the surfaces this train added (the finalise help,
  // the --fbs block of the verify run help, the docs section).
  const fbsBlock = VERIFY_RUN_HELP.slice(VERIFY_RUN_HELP.indexOf('--fbs <fbs-id>'), VERIFY_RUN_HELP.indexOf('--parity-env'));
  const scopeSection = docs.slice(docs.indexOf('## Verification scope'), docs.indexOf('## Runtime profiles and verdict authority'));
  for (const text of [FINALISE_HELP, fbsBlock, scopeSection]) {
    assert.doesNotMatch(text, /\u2014/);
  }
});
