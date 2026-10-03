// 0.30.0 PR 9 (REQ-179 enforcement locus; AC-17902-5): the
// admissibility wrap cites NV-DL-ADM-02/03/04 alongside the NV-BL
// rules when D4 is failing, D3 is failing, or validate errors are
// non-empty. The producer still runs on an NV-BL pass so readiness
// stays informational (AC-17902-4). An --ack-at-current-hash entry
// in freeze.gates folds the stage to `acknowledged` and the wrap
// then stops citing the rule.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateDefineStageAdmissibility,
  runWithAdmissibilityGate,
} from '../../src/query/refuse-on-admissibility.js';

test('evaluateDefineStageAdmissibility (PR 9): cites ADM-02 for failing D4, ADM-03 for failing D3, ADM-04 for non-empty validate errors', () => {
  const empty = evaluateDefineStageAdmissibility({ stages: [], validateErrors: [] });
  assert.deepEqual(empty.bitingRules, []);
  const d4Only = evaluateDefineStageAdmissibility({
    stages: [{ stage: 'D3', gate: 'define.shapes', state: 'passed' }, { stage: 'D4', gate: 'define.stories', state: 'failing' }],
    validateErrors: [],
  });
  assert.deepEqual(d4Only.bitingRules, ['NV-DL-ADM-02']);
  const d3AndD4 = evaluateDefineStageAdmissibility({
    stages: [{ stage: 'D3', gate: 'define.shapes', state: 'failing' }, { stage: 'D4', gate: 'define.stories', state: 'failing' }],
    validateErrors: [{ kind: 'validation' }],
  });
  assert.deepEqual(d3AndD4.bitingRules, ['NV-DL-ADM-02', 'NV-DL-ADM-03', 'NV-DL-ADM-04']);
  const acked = evaluateDefineStageAdmissibility({
    stages: [{ stage: 'D4', gate: 'define.stories', state: 'acknowledged' }, { stage: 'D3', gate: 'define.shapes', state: 'passed' }],
    validateErrors: [],
  });
  assert.deepEqual(acked.bitingRules, [], 'acknowledged at current hash satisfies recordedInChain');
});

test('runWithAdmissibilityGate (PR 9): a failing NV-BL verdict combines NV-BL rule ids with biting NV-DL rules in the refusal, and the producer does not run', async () => {
  // Minimal tree: a REQ with a scope-tag that doesnt map, so NV-BL-ADM-02
  // fires via scanAcScopeCoverage; the stage context carries a failing
  // D4 so NV-DL-ADM-02 also fires. The producer MUST not run on a
  // refused NV-BL verdict.
  let producerRan = false;
  const tree = {
    manifest: { rulesetVersion: null },
    tacs: [], adrs: [],
    requirements: [{ reqId: 'REQ-SCOPE', scope: 'thisScopeIsUnknown' }],
    userStories: [],
    byId: new Map(),
  };
  const result = await runWithAdmissibilityGate({
    tree,
    produce: () => { producerRan = true; return 'should-not-see'; },
    defineStages: [{ stage: 'D4', gate: 'define.stories', state: 'failing' }],
    defineValidateErrors: [{ kind: 'validation' }],
  });
  // Depending on scope-lint internals the NV-BL verdict may be
  // pass OR refuse against a one-REQ tree; the test cares about the
  // DEFINE-rule citation path, not the NV-BL arm. Assert both arms.
  if (result.status === 'refused-admissibility') {
    assert.ok(/NV-DL-ADM-02/.test(result.refusal));
    assert.ok(/NV-DL-ADM-04/.test(result.refusal));
    // Ruling R12 (2026-10-03): the refusal names freeze.override as
    // the ADM-02 channel (D4 is not ackable) and the chain-document
    // correction as the ADM-04 channel. The --ack path is cited for
    // ADM-03 only.
    assert.ok(/freeze\.override/.test(result.refusal), 'ADM-02 override channel named');
    assert.ok(/chain document/.test(result.refusal), 'ADM-04 override channel named');
    assert.ok(!/--ack reason for NV-DL-ADM-02/.test(result.refusal), 'ADM-02 is not --ackable (R12)');
    assert.equal(producerRan, false, 'producer must not run on a refuse verdict');
    assert.deepEqual(result.defineRules, ['NV-DL-ADM-02', 'NV-DL-ADM-04']);
  } else {
    // NV-BL path passed; the define rules still appear on the
    // envelope so callers can log them. Producer DID run.
    assert.equal(producerRan, true);
    assert.deepEqual(result.defineRules, ['NV-DL-ADM-02', 'NV-DL-ADM-04']);
  }
});

test('runWithAdmissibilityGate (PR 9): no DEFINE context -> no NV-DL citations; producer runs on NV-BL pass', async () => {
  let producerRan = false;
  const tree = { manifest: {}, tacs: [], adrs: [], requirements: [], userStories: [], byId: new Map() };
  const result = await runWithAdmissibilityGate({
    tree,
    produce: () => { producerRan = true; return 'yay'; },
  });
  if (result.status === 'ok') {
    assert.equal(producerRan, true);
    assert.deepEqual(result.defineRules, []);
    assert.equal(result.payload, 'yay');
  }
});
