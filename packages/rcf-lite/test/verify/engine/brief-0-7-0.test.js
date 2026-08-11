// Brief suffix tests for the 0.7.0 train
// (verification-integrity-cluster-spec §5.2 service-attestation suffix,
// ui-design-gate-0.7.0-spec §8.7 UI-invariant suffix).
//
// Both suffixes are PROMPT-ONLY additions to the disprove line: no
// source-tree reading, no separate journey, no happy-path framing. The
// tests lock the wording so a downstream reader knows what the suffix
// looks like and can grep for it in an agent transcript.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { composeBrief } from '../../../src/verify/engine/brief.js';

const baseAc = {
  acId: 'AC-101-1',
  usId: 'US-101',
  title: 'Core purchase journey',
  given: 'a registered account exists',
  when: 'the user submits the sign-in form',
  then: 'the user reaches their dashboard',
  testable: true,
  serviceAttestations: [],
  fbsUiBearing: false,
};

test('composeBrief: no attestations, not UI-bearing -> disprove line unchanged from pre-0.7.0', () => {
  const brief = composeBrief({ acs: [baseAc], url: 'https://app' });
  const j = brief.journeys[0];
  assert.equal(j.disprove.startsWith('Attempt to make the app FAIL'), true);
  // No suffix text.
  assert.equal(j.disprove.includes('delivery observable'), false);
  assert.equal(j.disprove.includes('shared nav bar'), false);
});

test('composeBrief: service attestation suffix names the service and the mode', () => {
  const brief = composeBrief({
    acs: [{
      ...baseAc,
      serviceAttestations: [
        { serviceId: 'resend', attestationMode: 'declaredMockOnly' },
      ],
    }],
    url: 'https://app',
  });
  const disprove = brief.journeys[0].disprove;
  assert.match(disprove, /service `resend` attested `declaredMockOnly`/);
  assert.match(disprove, /delivery observable/);
  assert.match(disprove, /admin-log endpoint/);
});

test('composeBrief: multiple attestations produce one suffix per service', () => {
  const brief = composeBrief({
    acs: [{
      ...baseAc,
      serviceAttestations: [
        { serviceId: 'resend', attestationMode: 'declaredMockOnly' },
        { serviceId: 'stripe', attestationMode: 'sandboxed' },
      ],
    }],
    url: 'https://app',
  });
  const disprove = brief.journeys[0].disprove;
  const hits = (disprove.match(/delivery observable/g) ?? []).length;
  assert.equal(hits, 2);
  assert.match(disprove, /`resend`/);
  assert.match(disprove, /`stripe`/);
});

test('composeBrief: UI-bearing AC gets the shared-nav / theme-toggle / signed-in-as suffix', () => {
  const brief = composeBrief({
    acs: [{ ...baseAc, fbsUiBearing: true }],
    url: 'https://app',
  });
  const disprove = brief.journeys[0].disprove;
  assert.match(disprove, /UI-bearing/);
  assert.match(disprove, /shared nav bar/);
  assert.match(disprove, /theme toggle/);
  assert.match(disprove, /signed-in-as affordance/);
  assert.match(disprove, /Disprove any of these by observation/);
});

test('composeBrief: UI + attestation suffixes co-exist on the same AC', () => {
  const brief = composeBrief({
    acs: [{
      ...baseAc,
      fbsUiBearing: true,
      serviceAttestations: [{ serviceId: 'stripe', attestationMode: 'live' }],
    }],
    url: 'https://app',
  });
  const disprove = brief.journeys[0].disprove;
  assert.match(disprove, /delivery observable/);
  assert.match(disprove, /shared nav bar/);
});

test('composeBrief: never mentions source tree, tests, or build reports (independence guarantee 4)', () => {
  const brief = composeBrief({
    acs: [{
      ...baseAc,
      fbsUiBearing: true,
      serviceAttestations: [{ serviceId: 'resend', attestationMode: 'mocked' }],
    }],
    url: 'https://app',
  });
  const disprove = brief.journeys[0].disprove;
  for (const banned of [/read the source/i, /consult the tests/i, /check the build report/i]) {
    assert.doesNotMatch(disprove, banned);
  }
});
