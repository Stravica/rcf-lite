// Chain-reader derivation tests for the 0.7.0 train
// (verification-integrity-cluster-spec §5.2, ui-design-gate-0.7.0-spec §8.7).
//
// Every AC-level derivation ships FROM verify — core surfaces raw fields
// only, per the tonight's clarification (Track A changelog 2026-07-31 +
// Track B §18 N2 fold). These tests lock the derivation shape and the
// independence-guarantee-preserving property that the derivation runs off
// walker output alone (no source-tree reads).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readChain } from '../../src/chain/index.js';
import { scaffoldChain } from '../helpers/chain.js';

/** Convenience: a minimal 0.7.0-shape FBS built off the init-created FBS-001 slot. */
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

test('readChain: pre-0.7.0 chain flattens ACs unchanged; derived fields are empty arrays / false', async () => {
  // No FBS overrides, no manifest additions — the older chain shape must
  // still validate and the derivation must degrade honestly (empty attest,
  // fbsUiBearing false, empty fbsIds when the AC is not bound to any FBS).
  const { root } = await scaffoldChain();
  const chain = await readChain({ repo: root });
  const ac1 = chain.acs.find((a) => a.acId === 'AC-101-1');
  const ac2 = chain.acs.find((a) => a.acId === 'AC-101-2');
  assert.deepEqual(ac1.serviceAttestations, []);
  assert.equal(ac1.fbsUiBearing, false);
  assert.deepEqual(ac1.fbsIds, ['FBS-001']); // init-created FBS-001 binds AC-101-1
  // AC-101-2 is not on any FBS in the default scaffold.
  assert.deepEqual(ac2.serviceAttestations, []);
  assert.equal(ac2.fbsUiBearing, false);
  assert.deepEqual(ac2.fbsIds, []);
  assert.deepEqual(chain.manifest.browserVerification ?? [], []);
});

test('readChain: serviceAttestations aggregates every FBS.dependsOnServices entry naming the AC', async () => {
  const { root } = await scaffoldChain({
    fbsItems: [
      fbs({
        acIds: ['AC-101-1', 'AC-101-2'],
        dependsOnServices: [
          { id: 'resend', displayName: 'Resend', purpose: 'email', attestationMode: 'declaredMockOnly', acIds: ['AC-101-2'] },
          { id: 'stripe', displayName: 'Stripe', purpose: 'payment', attestationMode: 'sandboxed', acIds: ['AC-101-1', 'AC-101-2'] },
        ],
      }),
    ],
  });
  const chain = await readChain({ repo: root });
  const ac1 = chain.acs.find((a) => a.acId === 'AC-101-1');
  const ac2 = chain.acs.find((a) => a.acId === 'AC-101-2');
  assert.deepEqual(ac1.serviceAttestations, [
    { serviceId: 'stripe', attestationMode: 'sandboxed' },
  ]);
  assert.deepEqual(ac2.serviceAttestations, [
    { serviceId: 'resend', attestationMode: 'declaredMockOnly' },
    { serviceId: 'stripe', attestationMode: 'sandboxed' },
  ]);
});

test('readChain: fbsUiBearing is true iff any FBS bound to the AC has uiBearing:true', async () => {
  const { root } = await scaffoldChain({
    fbsItems: [
      fbs({ acIds: ['AC-101-1', 'AC-101-3'], uiBearing: true }),
    ],
  });
  const chain = await readChain({ repo: root });
  assert.equal(chain.acs.find((a) => a.acId === 'AC-101-1').fbsUiBearing, true);
  assert.equal(chain.acs.find((a) => a.acId === 'AC-101-3').fbsUiBearing, true);
  // AC-101-2 has no FBS binding in this scaffold.
  assert.equal(chain.acs.find((a) => a.acId === 'AC-101-2').fbsUiBearing, false);
});

test('readChain: fbsIds preserves fbsItems order, only includes FBSes whose acIds include the AC', async () => {
  const { root } = await scaffoldChain({
    fbsItems: [
      fbs({ acIds: ['AC-101-1', 'AC-101-2'] }),
    ],
  });
  const chain = await readChain({ repo: root });
  assert.deepEqual(chain.acs.find((a) => a.acId === 'AC-101-1').fbsIds, ['FBS-001']);
  assert.deepEqual(chain.acs.find((a) => a.acId === 'AC-101-3').fbsIds, []);
});

test('readChain: surfaces manifest.uiBaseline and manifest.browserVerification verbatim', async () => {
  const uiBaseline = {
    id: 'uib-2026-07-30-001',
    createdAt: '2026-07-30T14:15:00Z',
    prdId: 'PRD-001',
    defaults: { themeMode: 'light-default-with-toggle' },
    operatorAckAt: '2026-07-30T14:15:00Z',
  };
  const browserVerification = [
    {
      id: 'bv-FBS-001-1',
      fbsId: 'FBS-001',
      createdAt: '2026-07-30T15:22:00Z',
      mode: 'operatorSession',
      runtimeProfile: 'local-dev',
      runtimeUrl: 'http://127.0.0.1:3000',
      routesChecked: [{ path: '/', screenshotPath: '.rcf/artefacts/x.png', themeApplied: 'light' }],
      invariantChecks: [{ invariant: 'sharedNavPresent', verdict: 'pass' }],
      verdict: 'pass',
    },
  ];
  const { root } = await scaffoldChain({ manifestPatch: { uiBaseline, browserVerification } });
  const chain = await readChain({ repo: root });
  assert.deepEqual(chain.manifest.uiBaseline, uiBaseline);
  assert.deepEqual(chain.manifest.browserVerification, browserVerification);
});

test('readChain: derivation ignores entries whose serviceDependency.acIds do not include the AC', async () => {
  // An FBS whose overall acIds includes AC-101-1 AND AC-101-2, but whose
  // dependsOnServices entry only names AC-101-2 - the AC-101-1 derivation
  // must NOT pick it up (Track A §3.1: dependsOnServices.acIds is the
  // per-service governance list, not the whole FBS scope).
  const { root } = await scaffoldChain({
    fbsItems: [
      fbs({
        acIds: ['AC-101-1', 'AC-101-2'],
        dependsOnServices: [
          { id: 'resend', displayName: 'Resend', purpose: 'email', attestationMode: 'mocked', acIds: ['AC-101-2'] },
        ],
      }),
    ],
  });
  const chain = await readChain({ repo: root });
  assert.deepEqual(chain.acs.find((a) => a.acId === 'AC-101-1').serviceAttestations, []);
  assert.deepEqual(chain.acs.find((a) => a.acId === 'AC-101-2').serviceAttestations, [
    { serviceId: 'resend', attestationMode: 'mocked' },
  ]);
});
