// Loop convergence tests for the PO intent-complete loop
// (AC-18603-1..5). Scripted fixture: apply every writeBack the
// questions object returns, recompute, assert the question count
// strictly decreases each turn and reaches zero.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeQuestions } from '../../src/query/questions.js';

/** Minimal stand-in for a readiness result composed from PO blockers. */
function readinessFor(poBlockers, engineerBlockers = []) {
  return {
    tree: { currentTreeHash: 'sha256:fixture', frozen: false, frozenAt: null, treeHash: null, buildAt: null, fbsTotal: 0 },
    delta: {},
    stages: [],
    nextAction: null,
    coverage: { tree: { totals: { requirements: 0, covered: 0, uncovered: 0 } }, delta: [] },
    decisions: [],
    freezeable: false,
    levels: {
      intentComplete: { ok: poBlockers.length === 0, blockedBy: poBlockers, nextAction: null },
      readyToBuild: { ok: poBlockers.length === 0 && engineerBlockers.length === 0, blockedBy: [...poBlockers, ...engineerBlockers], nextAction: null },
    },
    personas: {
      productOwner: { blockers: poBlockers, nextAction: null },
      engineer: { blockers: engineerBlockers, nextAction: null },
    },
  };
}

/**
 * Minimal fixture state: an object we mutate per turn. The scripted
 * loop computes the current PO blockers from the state, then applies
 * each writeBack from the questions object by moving the state
 * forward in a way that removes the item.
 */
function initialState() {
  return {
    briefStatements: [
      { id: 1, kind: 'capability', text: 'Officers can put a loan on hold.', source: 'briefs/x.md:12-14' },
      { id: 2, kind: 'constraint', text: 'A hold must not accrue late fees.', source: 'briefs/x.md:15' },
      { id: 3, kind: 'openQuestion', text: 'Who approves a hold over 30 days?', source: 'briefs/x.md:16' },
    ],
    requirements: [
      { reqId: 'REQ-200', title: 'Loan lifecycle', description: 'TODO', domain: '' },
    ],
    userStories: [],
    decisions: [],
    profileSurface: null,
    profileRegister: null,
  };
}

function derivePoBlockers(state) {
  const blockers = [];
  // D1 brief:openQuestions: unresolved openQuestion with no decision.
  const open = state.briefStatements.filter((s) => s.kind === 'openQuestion' && s.status !== 'resolved');
  if (open.length > 0) {
    blockers.push({
      stage: 'D1', gate: 'G', check: 'brief:openQuestions', persona: 'productOwner', over: 'tree',
      failingCount: open.length, ids: open.map((s) => `brief:${s.id}`), question: 'Any open questions in the brief?',
    });
  }
  // D2 skeleton:resolvedBy: capability/constraint/entity statements without resolvedBy.
  const resolving = state.briefStatements.filter((s) => ['capability', 'constraint', 'entity', 'actor', 'externalSystem', 'surface'].includes(s.kind) && !s.resolvedBy);
  if (resolving.length > 0) {
    blockers.push({
      stage: 'D2', gate: 'G', check: 'skeleton:resolvedBy', persona: 'productOwner', over: 'tree',
      failingCount: resolving.length, ids: resolving.map((s) => `brief:${s.id}`), question: 'Does this statement become a requirement, an entity, or an omission?',
    });
  }
  // D2 skeleton:reqIntent: REQs with TODO description or missing domain.
  const todoReqs = state.requirements.filter((r) => (!r.description || /TODO/.test(r.description)) || !r.domain);
  if (todoReqs.length > 0) {
    blockers.push({
      stage: 'D2', gate: 'G', check: 'skeleton:reqIntent', persona: 'productOwner', over: 'tree',
      failingCount: todoReqs.length, ids: todoReqs.map((r) => r.reqId), question: 'What does this requirement mean?',
    });
  }
  // D4 stories:reqHasUs: REQs without an owning US.
  const reqsNoUs = state.requirements.filter((r) => !state.userStories.some((us) => us.reqId === r.reqId));
  if (reqsNoUs.length > 0) {
    blockers.push({
      stage: 'D4', gate: 'G', check: 'stories:reqHasUs', persona: 'productOwner', over: 'tree',
      failingCount: reqsNoUs.length, ids: reqsNoUs.map((r) => r.reqId), question: 'What does someone do with this requirement?',
    });
  }
  return blockers;
}

/** Apply the first write-back of a question against the scripted state. */
function applyWriteBack(state, q) {
  if (q.check === 'brief:openQuestions') {
    const s = state.briefStatements.find((x) => `brief:${x.id}` === q.itemId);
    if (s) s.status = 'resolved';
    return true;
  }
  if (q.check === 'skeleton:resolvedBy') {
    const s = state.briefStatements.find((x) => `brief:${x.id}` === q.itemId);
    if (s) s.resolvedBy = 'omitted:scripted';
    return true;
  }
  if (q.check === 'skeleton:reqIntent') {
    const r = state.requirements.find((x) => x.reqId === q.itemId);
    if (r) {
      r.description = 'Scripted description for the loop fixture.';
      r.domain = 'loans';
    }
    return true;
  }
  if (q.check === 'stories:reqHasUs') {
    const r = state.requirements.find((x) => x.reqId === q.itemId);
    if (r) {
      state.userStories.push({ usId: `US-${r.reqId}01`, reqId: r.reqId, title: 'scripted', acceptanceCriteria: [] });
    }
    return true;
  }
  return false;
}

function makeTree(state) {
  return {
    manifest: null, prd: null, tad: null, bs: null,
    requirements: state.requirements,
    userStories: state.userStories,
    tacs: [], adrs: [], fbsItems: [], testSuites: [], codeNodes: [], evals: [],
    byId: new Map(), kindById: new Map(), brokenIds: new Set(), invalidDocs: new Map(),
    parentByChild: new Map(), childrenByParent: new Map(),
  };
}

// --- AC-18603-1 convergence to zero ---

test('AC-18603-1: scripted loop converges strictly to zero within a bounded number of turns', () => {
  const state = initialState();
  let prevCount = Infinity;
  let turn = 0;
  while (turn < 25) {
    const blockers = derivePoBlockers(state);
    const r = readinessFor(blockers);
    const ledgers = { brief: { statements: state.briefStatements }, decisions: { decisions: state.decisions } };
    const q = computeQuestions(r, { tree: makeTree(state), ledgers, persona: 'productOwner' });
    if (q.questions.length === 0) {
      assert.equal(q.ok, true);
      return;
    }
    assert.ok(q.questions.length < prevCount || turn === 0, `question count did not decrease: prev=${prevCount}, now=${q.questions.length}`);
    prevCount = q.questions.length;
    for (const entry of q.questions) {
      applyWriteBack(state, entry);
    }
    turn += 1;
  }
  assert.fail(`loop did not converge in 25 turns`);
});

// --- AC-18603-2 a new REQ carries intent ---

test('AC-18603-2: a new REQ with description and domain passes reqIntent and asks reqHasUs once', () => {
  const state = initialState();
  // Simulate "statement resolved to new REQ":
  state.requirements.push({ reqId: 'REQ-201', title: 'Hold rules', description: 'Officers may hold loans.', domain: 'loans' });
  state.briefStatements[0].resolvedBy = 'REQ-201';
  state.briefStatements[1].resolvedBy = 'REQ-201';
  state.briefStatements[2].status = 'resolved';
  // Still TODO on REQ-200, so there is one reqIntent and two reqHasUs.
  const blockers = derivePoBlockers(state);
  const r = readinessFor(blockers);
  const ledgers = { brief: { statements: state.briefStatements }, decisions: { decisions: [] } };
  const q = computeQuestions(r, { tree: makeTree(state), ledgers, persona: 'productOwner' });
  const reqIntentOnNew = q.questions.find((e) => e.check === 'skeleton:reqIntent' && e.itemId === 'REQ-201');
  assert.equal(reqIntentOnNew, undefined, 'REQ-201 should NOT appear in reqIntent (description + domain supplied)');
  const reqHasUsOnNew = q.questions.find((e) => e.check === 'stories:reqHasUs' && e.itemId === 'REQ-201');
  assert.ok(reqHasUsOnNew, 'REQ-201 should surface in reqHasUs');
});

// --- AC-18603-3 L1 stable under [draft] entity adds ---

test('AC-18603-3: at L1 adding engineer-only draft entities keeps the PO question set empty', () => {
  // L1 state: no PO blockers.
  const engineerBlockers = [
    { stage: 'D3', gate: 'G', check: 'shapes:draftSettled', persona: 'engineer', over: 'tree',
      failingCount: 2, ids: ['TAC-100', 'TAC-101'], question: 'engineer draft prefix check' },
  ];
  const r = readinessFor([], engineerBlockers);
  const q = computeQuestions(r, { tree: makeTree(initialState()), ledgers: { brief: { statements: [] } }, persona: 'productOwner' });
  assert.equal(q.ok, true);
  assert.deepEqual(q.questions, []);
});

// --- AC-18603-4 openQuestion promoted to a decision ---

test('AC-18603-4: an openQuestion promoted to a one-option decision asks decisions:wellFormed once', () => {
  const state = initialState();
  // Mark the openQuestion resolved (the promotion resolved it).
  state.briefStatements[2].status = 'resolved';
  state.briefStatements[2].resolvedBy = 'decision 1';
  // The decisions ledger carries the under-filled decision.
  state.decisions.push({ id: 1, question: 'Who approves a hold over 30 days?', options: [{ letter: 'a', summary: 'manager' }], default: null, status: 'open' });
  // No PO blocker says openQuestion is unresolved. We synthesise a
  // decisions:wellFormed blocker (what readiness would do with the
  // under-filled decision).
  const poBlockers = [{
    stage: 'D7', gate: 'G', check: 'decisions:wellFormed', persona: 'productOwner', over: 'tree',
    failingCount: 1, ids: ['decision:1'], question: 'Every decision is enumerated.',
  }];
  const r = readinessFor(poBlockers);
  const ledgers = { brief: { statements: state.briefStatements }, decisions: { decisions: state.decisions } };
  const q = computeQuestions(r, { tree: makeTree(state), ledgers, persona: 'productOwner' });
  // openQuestions did not ask again.
  assert.equal(q.questions.find((e) => e.check === 'brief:openQuestions'), undefined);
  // wellFormed asked once.
  assert.equal(q.questions.filter((e) => e.check === 'decisions:wellFormed').length, 1);
});

// --- AC-18603-5 engineer edits do not re-open the PO loop ---

test('AC-18603-5: an engineer-only edit never changes the PO question set', () => {
  // Starting state with a known PO question set.
  const state = initialState();
  const r1 = readinessFor(derivePoBlockers(state));
  const q1 = computeQuestions(r1, { tree: makeTree(state), ledgers: { brief: { statements: state.briefStatements }, decisions: { decisions: [] } }, persona: 'productOwner' });

  // "Engineer edit" = adding failing engineer blockers only.
  const engineerBlockers = [
    { stage: 'D3', gate: 'G', check: 'shapes:draftSettled', persona: 'engineer', over: 'tree',
      failingCount: 1, ids: ['TAC-100'], question: 'engineer' },
    { stage: 'D4', gate: 'G', check: 'stories:usFloors', persona: 'engineer', over: 'tree',
      failingCount: 1, ids: ['US-20001'], question: 'engineer' },
  ];
  const r2 = readinessFor(derivePoBlockers(state), engineerBlockers);
  const q2 = computeQuestions(r2, { tree: makeTree(state), ledgers: { brief: { statements: state.briefStatements }, decisions: { decisions: [] } }, persona: 'productOwner' });

  assert.deepEqual(q1.questions.map((e) => e.id), q2.questions.map((e) => e.id));
});
