// End-to-end engine tests for the 0.7.0 per-AC verdict flow. Reads a
// scaffolded chain, runs `runVerification` with a stub launcher, and
// asserts the report emits perAcVerdicts in the shape the merged
// finalise-gate consumer (packages/rcf-lite/src/finalise/ingest.js) expects.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isRcfError } from '#core/errors';
import { runVerification } from '../../../src/verify/engine/index.js';
import { scaffoldChain, stubLauncher } from '../helpers/chain.js';

const FIXED_NOW = () => '2026-07-31T12:00:00.000Z';

function fbs(patch) {
  return {
    fbsId: 'FBS-001',
    prdId: 'PRD-001',
    bsId: 'BS-001',
    buildOrder: 1,
    executionStatus: 'notStarted',
    title: 'test',
    summary: 'test',
    acIds: ['AC-101-1'],
    dependsOnFbsIds: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...patch,
  };
}

const passFinding = (acId) => ({
  severity: 'PASS',
  acId,
  journey: 'j',
  reproSteps: ['open /'],
  evidence: { kind: 'note', detail: 'ok' },
});

test('runVerification: report carries perAcVerdicts derived from chain service attestations', async () => {
  const { root } = await scaffoldChain({
    fbsItems: [
      fbs({
        acIds: ['AC-101-1', 'AC-101-2'],
        dependsOnServices: [
          { id: 'resend', displayName: 'Resend', purpose: 'email', attestationMode: 'declaredMockOnly', acIds: ['AC-101-2'] },
        ],
      }),
    ],
  });
  const res = await runVerification(
    { repo: root, profile: 'ci', url: 'http://localhost:3000', provisionMode: 'skip' },
    { now: FIXED_NOW, launchAgent: stubLauncher([passFinding('AC-101-1'), passFinding('AC-101-2'), passFinding('AC-101-3')]) },
  );
  assert.ok(!isRcfError(res));
  assert.equal(res.report.verdict, 'PASS');
  assert.equal(res.report.perAcVerdicts?.length, 1);
  assert.equal(res.report.perAcVerdicts[0].acId, 'AC-101-2');
  assert.equal(res.report.perAcVerdicts[0].verdict, 'BLOCKED-BY-DECLARATION');
});

test('runVerification: chain-derived perAcVerdicts land on a NOT-DEPLOYED report too (chain evidence, not run-time)', async () => {
  // Even when the deployed reachability gate refuses to issue a
  // run-level verdict, the chain-derived per-AC verdicts still ship so
  // finalise sees the honest picture.
  const { root } = await scaffoldChain({
    fbsItems: [
      fbs({
        acIds: ['AC-101-1'],
        dependsOnServices: [
          { id: 'resend', displayName: 'Resend', purpose: 'email', attestationMode: 'mocked', acIds: ['AC-101-1'] },
        ],
      }),
    ],
  });
  const res = await runVerification(
    { repo: root, profile: 'deployed', url: 'http://localhost:8787' },
    { now: FIXED_NOW, launchAgent: async () => { throw new Error('should not launch on NOT-DEPLOYED'); } },
  );
  assert.ok(!isRcfError(res));
  assert.equal(res.report.verdict, 'NOT-DEPLOYED');
  assert.equal(res.report.perAcVerdicts?.[0]?.verdict, 'MOCK-ONLY-DECLARED');
});

test('runVerification: chain with UI-bearing FBS but no browserVerification emits BROWSER-VERIFICATION-MISSING', async () => {
  const { root } = await scaffoldChain({
    fbsItems: [
      fbs({
        acIds: ['AC-101-1'],
        uiBearing: true,
      }),
    ],
  });
  const res = await runVerification(
    { repo: root, profile: 'ci', url: 'http://localhost:3000', provisionMode: 'skip' },
    { now: FIXED_NOW, launchAgent: stubLauncher([passFinding('AC-101-1'), passFinding('AC-101-2'), passFinding('AC-101-3')]) },
  );
  assert.ok(!isRcfError(res));
  const declared = res.report.perAcVerdicts?.find((v) => v.acId === 'AC-101-1');
  assert.equal(declared.verdict, 'BROWSER-VERIFICATION-MISSING');
});

test('runVerification: chain with UI-bearing FBS and a block browserVerification emits UI-BASELINE-UNMET', async () => {
  const { root } = await scaffoldChain({
    fbsItems: [
      fbs({ acIds: ['AC-101-1'], uiBearing: true }),
    ],
    manifestPatch: {
      browserVerification: [
        {
          id: 'bv-FBS-001-1',
          fbsId: 'FBS-001',
          createdAt: '2026-07-30T15:22:00Z',
          mode: 'operatorSession',
          runtimeProfile: 'local-dev',
          runtimeUrl: 'http://127.0.0.1:3000',
          routesChecked: [{ path: '/', screenshotPath: '.rcf/artefacts/x.png', themeApplied: 'light' }],
          invariantChecks: [{ invariant: 'sharedNavPresent', verdict: 'fail' }],
          verdict: 'block',
        },
      ],
    },
  });
  const res = await runVerification(
    { repo: root, profile: 'ci', url: 'http://localhost:3000', provisionMode: 'skip' },
    { now: FIXED_NOW, launchAgent: stubLauncher([passFinding('AC-101-1'), passFinding('AC-101-2'), passFinding('AC-101-3')]) },
  );
  assert.ok(!isRcfError(res));
  const declared = res.report.perAcVerdicts?.find((v) => v.acId === 'AC-101-1');
  assert.equal(declared.verdict, 'UI-BASELINE-UNMET');
});

test('runVerification: pre-0.7.0 chain (no FBS 0.7.0 fields, no manifest baseline) omits perAcVerdicts on the report', async () => {
  // The scaffold's init-created FBS-001 has acIds:['AC-101-1'] but no
  // uiBearing / dependsOnServices, and no manifest browserVerification -
  // the report should not carry perAcVerdicts at all so
  // `packages/rcf-lite/src/finalise/ingest.js:findMockOnlyDeclaredAcs`
  // returns empty (the backward-compatible pre-0.7.0 case).
  const { root } = await scaffoldChain();
  const res = await runVerification(
    { repo: root, profile: 'ci', url: 'http://localhost:3000', provisionMode: 'skip' },
    { now: FIXED_NOW, launchAgent: stubLauncher([passFinding('AC-101-1'), passFinding('AC-101-2'), passFinding('AC-101-3')]) },
  );
  assert.ok(!isRcfError(res));
  assert.equal('perAcVerdicts' in res.report, false);
});
