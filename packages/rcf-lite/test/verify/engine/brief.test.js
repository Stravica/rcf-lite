// Brief composition tests (spec §5, §9 guarantee 4, §11).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { composeBrief, DEFAULT_PERSONA } from '../../src/engine/brief.js';

const acs = [
  { acId: 'AC-101-1', usId: 'US-101', title: 'sign-in', given: 'a registered account', when: 'the user logs in', then: 'dashboard shown', testable: true },
  { acId: 'AC-101-2', usId: 'US-101', title: 'checkout', given: 'items in cart', when: 'pay', then: 'receipt shown', testable: true },
  { acId: 'AC-101-9', usId: 'US-101', then: 'ignored', testable: false },
];

test('composeBrief: builds one journey per TESTABLE AC, off the chain only', () => {
  const brief = composeBrief({ acs, url: 'https://app.example.com', chainRef: 'PRD-001' });
  assert.equal(brief.acCount, 2); // non-testable AC excluded
  assert.deepEqual(brief.journeys.map((j) => j.acId), ['AC-101-1', 'AC-101-2']);
  assert.equal(brief.persona, DEFAULT_PERSONA);
  assert.equal(brief.stance, 'disprove');
  assert.equal(brief.url, 'https://app.example.com');
});

test('composeBrief: each journey carries a disprove prompt derived from the AC then-clause', () => {
  const brief = composeBrief({ acs, url: 'https://app' });
  assert.match(brief.journeys[0].disprove, /dashboard shown/);
});

test('composeBrief: instructions are adversarial, contain no build-context, forbid over-claiming (§9)', () => {
  const brief = composeBrief({ acs, url: 'https://app' });
  assert.match(brief.instructions, /DISPROVE/);
  assert.match(brief.instructions, /have NOT seen how this app was built/);
  assert.match(brief.instructions, /not a correctness guarantee/);
});

test('composeBrief: honours a custom persona', () => {
  const brief = composeBrief({ acs, url: 'https://app', persona: 'malicious-user' });
  assert.equal(brief.persona, 'malicious-user');
});
