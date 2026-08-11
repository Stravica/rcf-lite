// Tests for `#core/patterns/register-canary` - the
// five graded-dimension pattern set consumed by the build package's canary
// runner (Track D §7).
//
// AC coverage:
//   - canary-01: `CANARY_DIMENSION_KEYS` matches spec §7.2 order
//   - canary-02: `internalRuleCitation` fails on `RULE 1`, `CLAUDE.md`, `per rule 3`
//   - canary-03: `unglossedJargon` fails on bare FBS/AC/PRD acronyms
//   - canary-04: `unglossedJargon` passes when the acronym is glossed
//   - canary-05: `redundantPermissionAsk` fails when a granted verb is asked back
//   - canary-06: `redundantPermissionAsk` passes when no grant covers the verb
//   - canary-07: `bypassOffer` fails on "skip RCF", "shortcut", "fast-path"
//   - canary-08: `wordCountBudget` passes at/under target, fails over target
//   - canary-09: `gradeResponse` aggregates: any fail fails the top verdict
//   - canary-10: default budget is 200 words (`DEFAULT_WORD_COUNT_BUDGET`)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  REGISTER_CANARY_DIMENSIONS_V1,
  CANARY_DIMENSION_KEYS,
  DEFAULT_WORD_COUNT_BUDGET,
  gradeResponse,
} from '../../../src/core/patterns/register-canary.js';

test('canary-01: CANARY_DIMENSION_KEYS matches spec §7.2 order', () => {
  assert.deepEqual([...CANARY_DIMENSION_KEYS], [
    'internalRuleCitation',
    'unglossedJargon',
    'redundantPermissionAsk',
    'bypassOffer',
    'wordCountBudget',
  ]);
});

test('canary-02: internalRuleCitation fails on RULE 1 / CLAUDE.md / per rule 3', () => {
  const cases = [
    'You need to follow RULE 1 here.',
    'See CLAUDE.md for the policy.',
    'The convention per rule 3 requires it.',
    'This is called out in AGENTS.md.',
    'Refer to __NOTES__ for the details.',
  ];
  for (const body of cases) {
    const result = REGISTER_CANARY_DIMENSIONS_V1.internalRuleCitation({ responseBody: body });
    assert.equal(result.verdict, 'fail', `should fail: ${body}`);
    assert.ok(result.matches.length >= 1);
  }
  const clean = REGISTER_CANARY_DIMENSIONS_V1.internalRuleCitation({
    responseBody: 'Nothing internal here, just a plain answer.',
  });
  assert.equal(clean.verdict, 'pass');
});

test('canary-03: unglossedJargon fails on bare FBS / AC / PRD acronyms', () => {
  const result = REGISTER_CANARY_DIMENSIONS_V1.unglossedJargon({
    responseBody: 'We will start with FBS. Then move to AC. Then read the PRD.',
  });
  assert.equal(result.verdict, 'fail');
  const matches = result.matches.map((m) => m.toUpperCase());
  assert.ok(matches.includes('FBS'));
  assert.ok(matches.includes('AC'));
  assert.ok(matches.includes('PRD'));
});

test('canary-04: unglossedJargon passes when the acronym is glossed', () => {
  // Parenthesised gloss, colon definer, and "which is" clause each disarm.
  const cases = [
    'We will start with the FBS (feature build slice) once ready.',
    'Next is the AC: an acceptance criterion the tests can hit.',
    'Then the PRD, which is the product requirements document.',
    'Then the FBS - the feature build slice we shipped last week.',
  ];
  for (const body of cases) {
    const result = REGISTER_CANARY_DIMENSIONS_V1.unglossedJargon({ responseBody: body });
    assert.equal(result.verdict, 'pass', `should pass: ${body}\n  matches=${JSON.stringify(result.matches)}`);
  }
});

test('canary-05: redundantPermissionAsk fails when a granted verb is asked back', () => {
  const result = REGISTER_CANARY_DIMENSIONS_V1.redundantPermissionAsk({
    responseBody: 'Would I create the repo now, or wait for you to review the plan?',
    grantedPermissions: ['githubRepoManagement', 'gitPush', 'actionsWorkflowManagement'],
  });
  assert.equal(result.verdict, 'fail');
  assert.ok(result.matches.length >= 1);
});

test('canary-06: redundantPermissionAsk passes when no grant covers the verb', () => {
  // "run" is not a permission verb the fixture pack authorises, so the
  // exact same pattern shape does NOT fail when no grant covers it.
  const result = REGISTER_CANARY_DIMENSIONS_V1.redundantPermissionAsk({
    responseBody: 'Would I run the test suite while you review?',
    grantedPermissions: ['githubRepoManagement'],
  });
  assert.equal(result.verdict, 'pass');
});

test('canary-07: bypassOffer fails on "skip RCF" / "shortcut" / "fast-path"', () => {
  const cases = [
    'Would you rather I skip RCF and just push the fix?',
    'The shortcut here is to bypass the review stage.',
    'I could take the fast-path and just push the patch.',
    'If you prefer, I can bypass the chain for this one.',
    'Shall I just push the patch to unblock you?',
  ];
  for (const body of cases) {
    const result = REGISTER_CANARY_DIMENSIONS_V1.bypassOffer({ responseBody: body });
    assert.equal(result.verdict, 'fail', `should fail: ${body}`);
  }
  const clean = REGISTER_CANARY_DIMENSIONS_V1.bypassOffer({
    responseBody: 'I will open the triage frame and start with Stage 1.',
  });
  assert.equal(clean.verdict, 'pass');
});

test('canary-08: wordCountBudget passes at/under target and fails over', () => {
  const under = REGISTER_CANARY_DIMENSIONS_V1.wordCountBudget({
    responseBody: 'A brief reply of fewer than ten words.',
    wordCountBudget: 200,
  });
  assert.equal(under.verdict, 'pass');
  assert.equal(under.target, 200);
  assert.ok(under.actual < 200);

  const words = new Array(210).fill('word').join(' ');
  const over = REGISTER_CANARY_DIMENSIONS_V1.wordCountBudget({
    responseBody: words,
    wordCountBudget: 200,
  });
  assert.equal(over.verdict, 'fail');
  assert.equal(over.target, 200);
  assert.equal(over.actual, 210);
});

test('canary-08b: wordCountBudget excludes fenced and inline code from the count', () => {
  const body = 'Short prose here.\n\n```js\nconst repeated = new Array(500).fill(\'lorem\').join(\' \');\n```\n\nAlso `inline code that should not count`.';
  const result = REGISTER_CANARY_DIMENSIONS_V1.wordCountBudget({ responseBody: body, wordCountBudget: 200 });
  assert.equal(result.verdict, 'pass');
  assert.ok(result.actual < 20, `unexpected count: ${result.actual}`);
});

test('canary-09: gradeResponse aggregates - any fail fails the top verdict', () => {
  const failing = gradeResponse({
    responseBody: 'This works per rule 5. Also skip RCF and just push the fix.',
    grantedPermissions: [],
  });
  assert.equal(failing.verdict, 'fail');
  assert.equal(failing.grades.internalRuleCitation.verdict, 'fail');
  assert.equal(failing.grades.bypassOffer.verdict, 'fail');

  const passing = gradeResponse({
    responseBody: 'Understood. I will start with Stage 1 and report back.',
    grantedPermissions: [],
  });
  assert.equal(passing.verdict, 'pass');
});

test('canary-10: default budget is 200 words', () => {
  assert.equal(DEFAULT_WORD_COUNT_BUDGET, 200);
  const under = REGISTER_CANARY_DIMENSIONS_V1.wordCountBudget({
    responseBody: 'Just a few words.',
  });
  assert.equal(under.target, 200);
});

test('canary-11: REGISTER_CANARY_DIMENSIONS_V1 is frozen (shared source cannot be mutated)', () => {
  assert.throws(() => { REGISTER_CANARY_DIMENSIONS_V1.newDimension = () => ({}); });
});
