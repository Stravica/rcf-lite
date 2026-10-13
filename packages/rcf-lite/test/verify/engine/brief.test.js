// Brief composition tests (spec §5, §9 guarantee 4, §11).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { composeBrief, DEFAULT_PERSONA } from '../../../src/verify/engine/brief.js';

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

// Issue #352: canonical AC text may be authored on `description` rather than
// the given/when/then triplet. Prior to the fix composeBrief dropped it, so
// Backstory slice-1 ACs reached the walk with an empty disprove line and the
// verifier reported "AC text was empty, so I read this criterion as...". The
// precedence is explicit here (BDD when complete, else description, else
// hard failure) and locked by test so a regression cannot pass silently.
test('composeBrief: description-only AC reaches the walk with real criterion text, not an empty disprove line (#352)', () => {
  const descOnlyAcs = [
    {
      acId: 'AC-900-1',
      usId: 'US-900',
      title: 'password reset',
      description: 'A signed-out user with a valid email can request a password reset email',
      given: '',
      when: '',
      then: '',
      testable: true,
    },
  ];
  const brief = composeBrief({ acs: descOnlyAcs, url: 'https://app' });
  assert.equal(brief.acCount, 1);
  const [journey] = brief.journeys;
  // The disprove line carries the description text (not empty quotes).
  assert.match(
    journey.disprove,
    /A signed-out user with a valid email can request a password reset email/,
  );
  // And the pre-fix empty-text framing is gone — no `""` triplet.
  assert.doesNotMatch(journey.disprove, /FAIL "" starting from ""/);
});

test('composeBrief: BDD triplet still wins when all three parts are non-empty (precedence is explicit)', () => {
  const bothFormsAcs = [
    {
      acId: 'AC-901-1',
      usId: 'US-901',
      title: 'checkout',
      // A chain that carries BOTH forms. The BDD triplet is the canonical
      // form here, and the structured disprove line must come from it so
      // existing BDD-authored chains are unaffected by the fix.
      description: 'Short prose summary that should NOT be the disprove line',
      given: 'items in the cart',
      when: 'the user completes checkout',
      then: 'a receipt is shown',
      testable: true,
    },
  ];
  const brief = composeBrief({ acs: bothFormsAcs, url: 'https://app' });
  const [journey] = brief.journeys;
  assert.match(journey.disprove, /FAIL "a receipt is shown" starting from "items in the cart" by doing "the user completes checkout"/);
  assert.doesNotMatch(journey.disprove, /Short prose summary/);
});

test('composeBrief: a testable AC with neither BDD triplet nor description is a hard failure naming the acId (#352)', () => {
  const emptyAcs = [
    {
      acId: 'AC-902-9',
      usId: 'US-902',
      title: 'empty criterion',
      description: '',
      given: '',
      when: '',
      then: '',
      testable: true,
    },
  ];
  assert.throws(
    () => composeBrief({ acs: emptyAcs, url: 'https://app' }),
    (err) => /AC-902-9/.test(err.message) && /empty/i.test(err.message),
  );
});

test('composeBrief: whitespace-only criterion text counts as empty (no silent empty-walk)', () => {
  const whitespaceAcs = [
    {
      acId: 'AC-902-10',
      usId: 'US-902',
      description: '   ',
      given: ' ',
      when: '\t',
      then: '\n',
      testable: true,
    },
  ];
  assert.throws(
    () => composeBrief({ acs: whitespaceAcs, url: 'https://app' }),
    /AC-902-10/,
  );
});

test('composeBrief: a non-testable empty AC is excluded and does NOT trip the hard failure', () => {
  const mixedAcs = [
    { acId: 'AC-903-1', usId: 'US-903', description: 'has text', testable: true },
    // not testable: whether its criterion is empty or not is irrelevant;
    // the guard applies only to ACs the walk would actually run against.
    { acId: 'AC-903-9', usId: 'US-903', description: '', given: '', when: '', then: '', testable: false },
  ];
  const brief = composeBrief({ acs: mixedAcs, url: 'https://app' });
  assert.equal(brief.acCount, 1);
  assert.equal(brief.journeys[0].acId, 'AC-903-1');
});
