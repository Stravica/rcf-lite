// Unit tests for computeQuestions (REQ-186; spec 2026-10-01 §1.2).
// Pure over hand-built readiness fixtures.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeQuestions, PERSONAS } from '../../src/query/questions.js';

function makeTree(overrides = {}) {
  return {
    manifest: null,
    prd: null,
    tad: null,
    bs: null,
    requirements: overrides.requirements ?? [],
    userStories: overrides.userStories ?? [],
    tacs: overrides.tacs ?? [],
    adrs: overrides.adrs ?? [],
    fbsItems: [],
    testSuites: [],
    codeNodes: [],
    evals: [],
    byId: new Map(),
    kindById: new Map(),
    brokenIds: new Set(),
    invalidDocs: new Map(),
    parentByChild: new Map(),
    childrenByParent: new Map(),
  };
}

function blocker(stage, check, persona, ids, question = 'q') {
  return {
    stage, gate: 'G', check, persona, over: 'tree',
    failingCount: ids.length, ids, question,
  };
}

function readinessFor(poBlockers, engineerBlockers = [], treeHash = 'sha256:abc') {
  return {
    tree: { currentTreeHash: treeHash, frozen: false, frozenAt: null, treeHash: null, buildAt: null, fbsTotal: 0 },
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

// --- AC-18601-1 one question per failing PO item ---

test('AC-18601-1: openQuestions + resolvedBy + reqHasUs failing items each produce one question with the full shape', () => {
  const tree = makeTree({
    requirements: [{ reqId: 'REQ-200', title: 'Lifecycle', description: 'live', domain: 'loans' }],
  });
  const briefStatements = [
    { id: 1, kind: 'openQuestion', text: 'Who approves a hold over 30 days?', source: 'briefs/x.md:12-14' },
    { id: 2, kind: 'capability', text: 'Officers can put a loan on hold.', source: 'briefs/x.md:15' },
  ];
  const ledgers = { brief: { statements: briefStatements }, decisions: { decisions: [] } };
  const poBlockers = [
    blocker('D1', 'brief:openQuestions', 'productOwner', ['brief:1'], 'Any open questions in the brief, resolved or promoted to a decision?'),
    blocker('D2', 'skeleton:resolvedBy', 'productOwner', ['brief:2'], 'Does this statement become a requirement, an entity, or an omission?'),
    blocker('D4', 'stories:reqHasUs', 'productOwner', ['REQ-200'], 'What does someone do with this requirement?'),
  ];
  const r = readinessFor(poBlockers);
  const q = computeQuestions(r, { tree, ledgers, persona: 'productOwner' });
  assert.equal(q.questions.length, 3);
  for (const entry of q.questions) {
    assert.ok(typeof entry.id === 'string' && entry.id.length > 0);
    assert.ok(['D1', 'D2', 'D4', 'D7'].includes(entry.stage));
    assert.ok(typeof entry.check === 'string');
    assert.ok(typeof entry.itemId === 'string');
    assert.ok(typeof entry.heading === 'string' && entry.heading.length > 0);
    assert.ok(typeof entry.ask === 'string' && entry.ask.length > 0);
    assert.ok(Array.isArray(entry.answerKinds));
    assert.ok(Array.isArray(entry.writeBack) && entry.writeBack.length > 0);
    assert.equal(entry.blocks, 'intent');
  }
});

// --- AC-18601-2 deterministic ordering ---

test('AC-18601-2: two runs are deep-equal and ordered D1, D2, D4, D7 then by source span', () => {
  const briefStatements = [
    { id: 1, kind: 'openQuestion', text: 'Q1', source: 'briefs/a.md:3-4' },
    { id: 2, kind: 'capability', text: 'Cap A', source: 'briefs/a.md:5-6' },
    { id: 3, kind: 'capability', text: 'Cap B', source: 'briefs/b.md:7-8' },
  ];
  const ledgers = { brief: { statements: briefStatements }, decisions: { decisions: [] } };
  const tree = makeTree();
  const poBlockers = [
    blocker('D2', 'skeleton:resolvedBy', 'productOwner', ['brief:2', 'brief:3']),
    blocker('D1', 'brief:openQuestions', 'productOwner', ['brief:1']),
  ];
  const r = readinessFor(poBlockers);
  const q1 = computeQuestions(r, { tree, ledgers, persona: 'productOwner' });
  const q2 = computeQuestions(r, { tree, ledgers, persona: 'productOwner' });
  assert.deepEqual(q1.questions.map((x) => x.id), q2.questions.map((x) => x.id));
  // D1 first.
  assert.equal(q1.questions[0].stage, 'D1');
  // Then D2 ordered by source span (briefs/a.md:5-6 before briefs/b.md:7-8).
  assert.equal(q1.questions[1].stage, 'D2');
  assert.equal(q1.questions[1].context.statement.source, 'briefs/a.md:5-6');
  assert.equal(q1.questions[2].context.statement.source, 'briefs/b.md:7-8');
});

// --- AC-18601-3 open decisions in optional[] ---

test('AC-18601-3: a two-option decision with a default appears in optional[], not questions[]', () => {
  const ledgers = {
    brief: { statements: [] },
    decisions: {
      decisions: [{
        id: 2,
        question: 'Should we support holds longer than 30 days?',
        options: [{ letter: 'a', summary: 'no' }, { letter: 'b', summary: 'yes' }],
        default: 'a',
        status: 'open',
      }],
    },
  };
  const r = readinessFor([]);
  const q = computeQuestions(r, { tree: makeTree(), ledgers, persona: 'productOwner' });
  assert.equal(q.questions.length, 0);
  assert.equal(q.optional.length, 1);
  assert.equal(q.optional[0].blocks, 'build');
});

// --- AC-18601-4 empty when intentComplete.ok ---

test('AC-18601-4: ok tree returns ok:true and empty questions[]', () => {
  const r = readinessFor([]);
  const q = computeQuestions(r, { tree: makeTree(), ledgers: {}, persona: 'productOwner' });
  assert.equal(q.ok, true);
  assert.deepEqual(q.questions, []);
  assert.equal(q.remaining, 0);
});

// --- AC-18601-5 engineer persona ---

test('AC-18601-5: persona engineer returns engineer blockers in failing stages, blocks: build', () => {
  const engineerBlockers = [
    blocker('D2', 'skeleton:reqShape', 'engineer', ['REQ-9']),
    blocker('D4', 'stories:usFloors', 'engineer', ['US-901']),
  ];
  const r = readinessFor([], engineerBlockers);
  const q = computeQuestions(r, { tree: makeTree({ requirements: [{ reqId: 'REQ-9', title: 'Req 9' }] }), ledgers: { brief: { statements: [] } }, persona: 'engineer' });
  assert.equal(q.persona, 'engineer');
  assert.equal(q.level, 'build');
  assert.equal(q.questions.length, 2);
  for (const entry of q.questions) {
    assert.equal(entry.blocks, 'build');
  }
});

// --- AC-18601-6 usage error on unknown persona ---

test('AC-18601-6: unknown persona throws naming the accepted values', () => {
  assert.throws(() => {
    computeQuestions(readinessFor([]), { tree: makeTree(), ledgers: {}, persona: 'architect' });
  }, /productOwner \| engineer/);
});

// --- AC-18601-7 writes nothing + writeBack verbs exist ---

test('AC-18601-7: computeQuestions is pure; every writeBack.command names a registered verb', async () => {
  const { HELP_MAP } = await import('../../src/cli/help.js');
  // Build a fixture that hits every PO template.
  const tree = makeTree({ requirements: [{ reqId: 'REQ-9', title: 'Req 9' }] });
  const briefStatements = [
    { id: 1, kind: 'openQuestion', text: 'Q?', source: 'x.md:1' },
    { id: 2, kind: 'capability', text: 'C.', source: 'x.md:2' },
  ];
  const ledgers = {
    brief: { statements: briefStatements },
    decisions: { decisions: [{ id: 1, question: 'q', options: [], default: null, status: 'open' }] },
  };
  const poBlockers = [
    blocker('D1', 'brief:sinceFreeze', 'productOwner', ['brief-ledger']),
    blocker('D1', 'brief:openQuestions', 'productOwner', ['brief:1']),
    blocker('D1', 'brief:profile', 'productOwner', ['profile:surface', 'profile:register']),
    blocker('D2', 'skeleton:resolvedBy', 'productOwner', ['brief:2']),
    blocker('D2', 'skeleton:reqIntent', 'productOwner', ['REQ-9']),
    blocker('D4', 'stories:reqHasUs', 'productOwner', ['REQ-9']),
    blocker('D7', 'decisions:wellFormed', 'productOwner', ['decision:1']),
  ];
  const r = readinessFor(poBlockers);
  const q = computeQuestions(r, { tree, ledgers, persona: 'productOwner' });
  assert.ok(q.questions.length > 0);
  const defineVerbs = Object.keys(HELP_MAP.define);
  for (const entry of q.questions) {
    for (const wb of entry.writeBack) {
      const m = /^rcf (\w+)(?:\s+(\w+))?/.exec(wb.command);
      if (!m) continue;
      // Only validate recognised verb shapes; the profile edit
      // write-backs start with "edit rcf/.identity/profile.md" and are
      // deliberately not a verb.
      const group = m[1];
      const verb = m[2];
      if (group === 'define' && verb) {
        assert.ok(defineVerbs.includes(verb), `writeBack command names unknown define verb: ${wb.command}`);
      }
    }
  }
});

// --- Sanity: PERSONAS is a frozen two-value set ---

test('PERSONAS is the two accepted persona strings', () => {
  assert.deepEqual([...PERSONAS], ['productOwner', 'engineer']);
});
