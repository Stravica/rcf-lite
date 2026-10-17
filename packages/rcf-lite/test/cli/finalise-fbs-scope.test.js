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

async function markVerified(root, fbsId) {
  const fbsPath = join(root, 'rcf', 'fbs', `${fbsId.toLowerCase()}.json`);
  const doc = JSON.parse(await readFile(fbsPath, 'utf8'));
  doc.executionStatus = 'verified';
  await writeFile(fbsPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
}

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
