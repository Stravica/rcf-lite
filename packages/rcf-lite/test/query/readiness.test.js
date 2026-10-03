// Unit tests for computeReadiness (REQ-175; proposal 2026-09-22
// §2.4, §6 v3).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeReadiness, deriveNextAction, shortHash } from '../../src/query/readiness.js';

// Minimal TreeModel factory copied from gates.test.js (kept local so
// the two test files stay independent).
function makeTree(overrides = {}) {
  const tree = {
    manifest: overrides.manifest ?? null,
    prd: overrides.prd ?? null,
    tad: overrides.tad ?? null,
    bs: overrides.bs ?? null,
    requirements: overrides.requirements ?? [],
    userStories: overrides.userStories ?? [],
    tacs: overrides.tacs ?? [],
    adrs: overrides.adrs ?? [],
    fbsItems: overrides.fbsItems ?? [],
    testSuites: overrides.testSuites ?? [],
    codeNodes: overrides.codeNodes ?? [],
    evals: overrides.evals ?? [],
    byId: new Map(),
    rawById: new Map(),
    kindById: new Map(),
    brokenIds: new Set(),
    invalidDocs: new Map(),
    parentByChild: new Map(),
    childrenByParent: new Map(),
    fbsByAcId: overrides.fbsByAcId ?? new Map(),
    dependentsByFbsId: new Map(),
    tsByAcId: new Map(),
    tcsByAcId: new Map(),
    usByTacId: new Map(),
    cnByAcId: new Map(),
    dependentsByCnId: new Map(),
    evalByAcId: new Map(),
  };
  const linkParent = (child, parent) => {
    if (!parent) return;
    tree.parentByChild.set(child, parent);
    const kids = tree.childrenByParent.get(parent) ?? [];
    kids.push(child);
    tree.childrenByParent.set(parent, kids);
  };
  for (const req of tree.requirements) {
    tree.byId.set(req.reqId, req); tree.kindById.set(req.reqId, 'req');
    if (req.prdId) linkParent(req.reqId, req.prdId);
  }
  for (const us of tree.userStories) {
    tree.byId.set(us.usId, us); tree.kindById.set(us.usId, 'userStory');
    linkParent(us.usId, us.reqId);
    for (const ac of us.acceptanceCriteria ?? []) {
      if (typeof ac?.id === 'string') linkParent(ac.id, us.usId);
    }
  }
  for (const tac of tree.tacs) { tree.byId.set(tac.tacId, tac); tree.kindById.set(tac.tacId, 'tac'); }
  for (const adr of tree.adrs) { tree.byId.set(adr.adrId, adr); tree.kindById.set(adr.adrId, 'adr'); }
  for (const fbs of tree.fbsItems) {
    tree.byId.set(fbs.fbsId, fbs); tree.kindById.set(fbs.fbsId, 'fbs');
    for (const acId of fbs.acIds ?? []) {
      const list = tree.fbsByAcId.get(acId) ?? [];
      list.push(fbs.fbsId);
      tree.fbsByAcId.set(acId, list);
    }
  }
  return tree;
}

const EMPTY_LEDGERS = {
  brief: { statements: [] },
  decisions: { decisions: [] },
  concerns: { concerns: [] },
  probes: { probes: [] },
};

// ---------------------------------------------------------------------------
// AC-17501-1: computeReadiness returns the section 2.4 shape;
// freezeable folds correctly.
// ---------------------------------------------------------------------------

test('readiness: returns the section 2.4 shape and freezeable folds correctly', () => {
  const tree = makeTree();
  const result = computeReadiness(tree, {
    freeze: null,
    ledgers: EMPTY_LEDGERS,
    profileText: 'productOwner viewer',
  });
  // Top-level keys.
  assert.ok(result.tree);
  assert.ok(result.delta);
  assert.ok(Array.isArray(result.stages));
  assert.equal(result.stages.length, 8);
  assert.ok(result.coverage && result.coverage.tree);
  assert.ok(Array.isArray(result.coverage.delta));
  assert.ok(Array.isArray(result.decisions));
  assert.equal(typeof result.freezeable, 'boolean');
  // tree summary shape.
  assert.equal(result.tree.frozen, false);
  assert.equal(typeof result.tree.currentTreeHash, 'string');
  assert.equal(typeof result.tree.fbsTotal, 'number');
  // Every stage in D1..D8 order.
  assert.deepEqual(result.stages.map((s) => s.stage), ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8']);
  // Empty tree + no ledger + no freeze -> D1 fails (no statement); D8 fails (no queue head).
  assert.equal(result.freezeable, false);
});

test('readiness: freezeable is true on a well-formed tree (every stage passed / notApplicable)', () => {
  // Craft a tree where every D1..D8 gate resolves to passed or
  // notApplicable AND the D8 mechanical checks all pass, so
  // freezeable === true and nextAction === null. The fixture is
  // unfrozen (freeze=null); the delta is the whole tree, scope is
  // every id, and no gate can collapse to notApplicable via an
  // empty-scope route -- every check must actually pass.
  const tac = {
    tacId: 'TAC-1',
    // Interface description carries every per-kind marker ADR-4131 /
    // AC-17404-1 requires on an httpRoute so shapes:templateMarkers
    // passes alongside the other D3 checks on this well-formed fixture.
    interfaces: [{
      name: 'ship',
      kind: 'httpRoute',
      description: 'method: POST\npath: /widgets\nrequest: { widget }\nresponse: { id }\nerrors: [422]',
    }],
  };
  const req = {
    reqId: 'REQ-1',
    title: 'req',
    description: 'a real requirement description',
    domain: 'ops',
    shapeClassification: { shapes: ['httpApi'] },
    resolvedBy: 'REQ-1',
  };
  const us = {
    usId: 'US-1',
    reqId: 'REQ-1',
    tacIds: ['TAC-1'],
    acceptanceCriteria: [
      { id: 'AC-1', testable: true, description: '[happy] user does the thing' },
      { id: 'AC-2', testable: true, description: '[failure] server returns 500' },
      { id: 'AC-3', testable: true, description: '[must-not] endpoint accepts unauth' },
    ],
  };
  const fbs = {
    fbsId: 'FBS-1',
    acIds: ['AC-1', 'AC-2', 'AC-3'],
    executionStatus: 'notStarted',
    dependsOnFbsIds: [],
    title: 'ship the thing',
    buildOrder: 1,
  };
  const tad = {
    tadId: 'TAD-1',
    securityArchitecture: 'jwt bearer with rotating refresh tokens',
    operationalConcerns: 'runbook exists',
    coreEntities: [],
    dataStores: [],
  };
  const adr = {
    adrId: 'ADR-1',
    title: 'Deploy target: Hetzner',
    status: 'accepted',
  };
  const tree = makeTree({
    tad,
    requirements: [req],
    userStories: [us],
    tacs: [tac],
    adrs: [adr],
    fbsItems: [fbs],
  });

  const result = computeReadiness(tree, {
    freeze: null,
    ledgers: {
      // One kinded, resolving brief statement satisfies D1 (statements
      // present, kind in the closed vocabulary, no open questions) and
      // D2 (capability statement carries resolvedBy).
      brief: {
        statements: [
          {
            id: 1,
            kind: 'capability',
            text: 'ship the thing',
            resolvedBy: 'REQ-1',
            status: 'open',
            addedAt: '2026-09-24T10:00:00Z',
          },
        ],
      },
      decisions: { decisions: [] },
      concerns: { concerns: [] },
      probes: { probes: [] },
    },
    // profile.md carries a review-surface marker (viewer) AND a
    // register marker (productOwner) -- both required by D1.
    profileText: 'productOwner viewer',
    validateErrors: [],
  });

  // Every stage passes or is notApplicable, and freezeable=true.
  const stageStates = Object.fromEntries(result.stages.map((s) => [s.stage, s.state]));
  for (const stage of ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8']) {
    assert.ok(
      stageStates[stage] === 'passed' || stageStates[stage] === 'notApplicable',
      `expected ${stage} to be passed or notApplicable, got ${stageStates[stage]} -- checks: ${JSON.stringify(result.stages.find((s) => s.stage === stage).checks.filter((c) => !c.ok), null, 2)}`,
    );
  }
  assert.equal(result.freezeable, true);
  assert.equal(result.nextAction, null);
  // AC-17502-2 invariant: L2 (readyToBuild) implying L1
  // (intentComplete) is a derived guarantee of the levels fold, not
  // an input. Pin it on the well-formed tree so a future refactor
  // that lets a failing PO check hide behind a passing L2 trips the
  // suite.
  assert.equal(result.levels.intentComplete.ok, true);
  assert.equal(result.levels.readyToBuild.ok, true);
});

// ---------------------------------------------------------------------------
// AC-17501-2: fan-out impacted / impactedFbs.
// ---------------------------------------------------------------------------

test('readiness: fan-out impacted / impactedFbs (frozen delta)', async () => {
  // Build a tree with a REQ-1 -> US-1 -> AC-1 chain owned by FBS-1.
  const req = {
    reqId: 'REQ-1', title: 'req', description: 'live', domain: 'x',
    shapeClassification: { shapes: [] },
  };
  const us = {
    usId: 'US-1', reqId: 'REQ-1', tacIds: ['TAC-1'],
    acceptanceCriteria: [{ id: 'AC-1', testable: true, description: '[happy] x' }],
  };
  const tac = { tacId: 'TAC-1', interfaces: [{ name: 'i', kind: 'httpRoute' }] };
  const fbs = { fbsId: 'FBS-1', acIds: ['AC-1'], executionStatus: 'notStarted', dependsOnFbsIds: [], title: 'ship' };
  const tree = makeTree({ requirements: [req], userStories: [us], tacs: [tac], fbsItems: [fbs] });

  // Freeze that names every id at a stale hash -> forces REQ-1 into 'changed'.
  const { hashDocument, computeTreeHash } = await import('../../src/query/delta.js');
  const staleHash = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
  const docHashes = {};
  for (const id of tree.byId.keys()) docHashes[id] = staleHash;
  const freeze = {
    frozenAt: '2026-09-01T00:00:00Z',
    treeHash: computeTreeHash(docHashes),
    docHashes,
    briefStatements: 0,
  };
  // Actually we want ONE id changed only; recompute doc hashes with a
  // matching hash for every id except REQ-1.
  const freeze2docHashes = {};
  for (const id of tree.byId.keys()) freeze2docHashes[id] = hashDocument(tree.byId.get(id));
  freeze2docHashes['REQ-1'] = staleHash; // stale => REQ-1 changed
  const freeze2 = {
    frozenAt: '2026-09-01T00:00:00Z',
    treeHash: computeTreeHash(freeze2docHashes),
    docHashes: freeze2docHashes,
    briefStatements: 0,
  };
  const result = computeReadiness(tree, {
    freeze: freeze2,
    ledgers: EMPTY_LEDGERS,
    profileText: 'productOwner viewer',
  });
  // REQ-1 changed; fan-out should reach US-1 (descendant), AC-1 (descendant),
  // and FBS-1 with actionNeeded 're-execute'.
  assert.deepEqual(result.delta.changed, ['REQ-1']);
  const impactedIds = new Set(result.delta.impacted.map((n) => n.id));
  assert.ok(impactedIds.has('US-1'));
  assert.ok(impactedIds.has('FBS-1'));
  assert.deepEqual(result.delta.impactedFbs, ['FBS-1']);
});

test('readiness: fan-out is skipped on the unfrozen whole-tree case', () => {
  const req = { reqId: 'REQ-1', title: 'req', shapeClassification: { shapes: [] } };
  const tree = makeTree({ requirements: [req] });
  const result = computeReadiness(tree, {
    freeze: null,
    ledgers: EMPTY_LEDGERS,
    profileText: 'productOwner viewer',
  });
  assert.equal(result.delta.impacted.length, 0);
  assert.deepEqual(result.delta.impactedFbs, []);
});

// ---------------------------------------------------------------------------
// AC-17501-3: coverage tree-wide and per REQ ancestor.
// ---------------------------------------------------------------------------

test('readiness: coverage tree-wide and per REQ ancestor', async () => {
  const req = {
    reqId: 'REQ-1', title: 'req', description: 'live', domain: 'x',
    shapeClassification: { shapes: [] },
  };
  const us = {
    usId: 'US-1', reqId: 'REQ-1', tacIds: ['TAC-1'],
    acceptanceCriteria: [{ id: 'AC-1', testable: true, description: '[happy] x' }],
  };
  const tac = { tacId: 'TAC-1', interfaces: [{ name: 'i', kind: 'httpRoute' }] };
  const fbs = { fbsId: 'FBS-1', acIds: ['AC-1'], executionStatus: 'notStarted', dependsOnFbsIds: [], title: 'ship' };
  const tree = makeTree({ requirements: [req], userStories: [us], tacs: [tac], fbsItems: [fbs] });
  const { hashDocument, computeTreeHash } = await import('../../src/query/delta.js');
  const freezeDocHashes = {};
  for (const id of tree.byId.keys()) freezeDocHashes[id] = hashDocument(tree.byId.get(id));
  freezeDocHashes['REQ-1'] = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
  const freeze = {
    frozenAt: '2026-09-01T00:00:00Z',
    treeHash: computeTreeHash(freezeDocHashes),
    docHashes: freezeDocHashes,
    briefStatements: 0,
  };
  const result = computeReadiness(tree, { freeze, ledgers: EMPTY_LEDGERS, profileText: 'productOwner viewer' });
  assert.ok(result.coverage.tree);
  // The delta REQ ancestor is REQ-1 -> one CoverageResult in coverage.delta.
  assert.equal(result.coverage.delta.length, 1);
});

// ---------------------------------------------------------------------------
// AC-17501-4: nextAction picks first failing stage and check.
// ---------------------------------------------------------------------------

test('readiness: nextAction picks first failing stage and check', () => {
  const tree = makeTree();
  const result = computeReadiness(tree, {
    freeze: null,
    ledgers: EMPTY_LEDGERS,
    // No profile text -> D1 fails profile markers as one of the checks.
    profileText: null,
  });
  assert.ok(result.nextAction);
  assert.equal(result.nextAction.stage, 'D1');
  assert.ok(result.nextAction.command.includes('rcf define readiness --check brief'));
  assert.ok(Array.isArray(result.nextAction.ids));
});

test('readiness: deriveNextAction returns null when no stage is failing', () => {
  const stages = [
    { stage: 'D1', state: 'passed', checks: [] },
    { stage: 'D2', state: 'notApplicable', checks: [] },
    { stage: 'D3', state: 'acknowledged', checks: [] },
  ];
  assert.equal(deriveNextAction(stages), null);
});

test('readiness: shortHash returns the first eight hex characters', () => {
  assert.equal(shortHash('sha256:c02f19aabbcc0011deadbeefcafefeedbaadbaad0001020304050607080910ab'), 'c02f19aa');
  assert.equal(shortHash(null), '(none)');
});

// ---------------------------------------------------------------------------
// AC-17501-6: loadAllLedgers omits absent files (covered in the
// dedicated ledger test file too; kept here for the readiness-side
// contract).
// ---------------------------------------------------------------------------

test('readiness: absent-ledger contract is honoured by the readiness composer', async () => {
  // If loadAllLedgers omits a ledger, computeDelta records no
  // ledger:<name> docHash for it. This test does not exercise the
  // filesystem loader (that lives in test/define/ledgers.test.js);
  // instead it asserts computeDelta's behaviour when passed a bundle
  // without a key.
  const { computeDelta } = await import('../../src/query/delta.js');
  const tree = makeTree();
  const d = computeDelta(tree, null, { brief: { statements: [] } });
  // Only the brief-ledger docHash appears; no ledger:decisions.
  assert.ok(d.added.some((id) => id === 'ledger:brief'));
  assert.equal(d.added.filter((id) => id.startsWith('ledger:')).length, 1);
});

// ---------------------------------------------------------------------------
// ADR-4126: levels + personas fold.
// ---------------------------------------------------------------------------

import {
  deriveLevels,
  derivePersonas,
  formatVerdictLines,
} from '../../src/query/readiness.js';

test('readiness (ADR-4126, AC-17502-3): brief:profile failing yields L1 blocker and PO next action', () => {
  const tree = makeTree();
  const result = computeReadiness(tree, {
    freeze: null,
    ledgers: EMPTY_LEDGERS,
    profileText: null,
  });
  assert.ok(result.levels, 'levels should exist');
  assert.equal(result.levels.intentComplete.ok, false);
  assert.ok(result.levels.intentComplete.blockedBy.length > 0);
  const profileBlocker = result.levels.intentComplete.blockedBy.find((b) => b.check === 'brief:profile');
  assert.ok(profileBlocker, 'brief:profile should be a PO blocker');
  assert.equal(profileBlocker.persona, 'productOwner');
  assert.equal(profileBlocker.stage, 'D1');
  assert.deepEqual([...profileBlocker.ids].sort(), ['profile:register', 'profile:surface']);
  // L1 nextAction command carries --level intent.
  assert.ok(result.levels.intentComplete.nextAction);
  assert.match(result.levels.intentComplete.nextAction.command, /--level intent/);
});

test('readiness (ADR-4126, AC-17502-5): personas.productOwner.blockers deep-equals L1 blockedBy; readyToBuild.nextAction equals nextAction', () => {
  const tree = makeTree();
  const result = computeReadiness(tree, {
    freeze: null,
    ledgers: EMPTY_LEDGERS,
    profileText: null,
  });
  assert.deepEqual(result.personas.productOwner.blockers, result.levels.intentComplete.blockedBy);
  assert.deepEqual(result.levels.readyToBuild.nextAction, result.nextAction);
});

test('readiness (ADR-4126, AC-17502-8): 0.28.4 fields present with their types', () => {
  const tree = makeTree();
  const result = computeReadiness(tree, {
    freeze: null,
    ledgers: EMPTY_LEDGERS,
    profileText: 'productOwner viewer',
  });
  assert.equal(typeof result.tree, 'object');
  assert.equal(typeof result.delta, 'object');
  assert.ok(Array.isArray(result.stages));
  assert.ok(result.nextAction === null || typeof result.nextAction === 'object');
  assert.ok(result.coverage && typeof result.coverage === 'object');
  assert.ok(Array.isArray(result.decisions));
  assert.equal(typeof result.freezeable, 'boolean');
});

test('readiness (ADR-4126, AC-17502-6): PO-nextAction prefers first PO-failing stage; engineer-nextAction prefers first engineer-failing stage', () => {
  // Build stages[] directly: D2 has engineer failures only; D4 has
  // both engineer and PO failing checks. PO nextAction should name
  // D4; engineer nextAction should name D2.
  const stages = [
    {
      stage: 'D1', gate: 'define.brief', state: 'passed', checks: [
        { name: 'brief:sinceFreeze', ok: true, over: 'delta', pass: 1, total: 1, failing: [], persona: 'productOwner', question: 'q' },
      ],
    },
    {
      stage: 'D2', gate: 'define.skeleton', state: 'failing', checks: [
        { name: 'skeleton:reqShape', ok: false, over: 'delta', pass: 0, total: 1, failing: [{ id: 'REQ-1', why: 'x' }], persona: 'engineer', question: 'q' },
      ],
    },
    {
      stage: 'D3', gate: 'define.shapes', state: 'passed', checks: [],
    },
    {
      stage: 'D4', gate: 'define.stories', state: 'failing', checks: [
        { name: 'stories:reqHasUs', ok: false, over: 'delta', pass: 0, total: 1, failing: [{ id: 'REQ-1', why: 'no US' }], persona: 'productOwner', question: 'q' },
        { name: 'stories:usFloors', ok: false, over: 'delta', pass: 0, total: 1, failing: [{ id: 'US-1', why: 'x' }], persona: 'engineer', question: 'q' },
      ],
    },
    { stage: 'D5', gate: 'define.crosscut', state: 'passed', checks: [] },
    { stage: 'D6', gate: 'define.consistency', state: 'passed', checks: [] },
    { stage: 'D7', gate: 'define.decisions', state: 'passed', checks: [] },
    { stage: 'D8', gate: 'define.freeze', state: 'passed', checks: [] },
  ];
  const nextAction = deriveNextAction(stages);
  assert.equal(nextAction.stage, 'D2'); // first failing stage, no persona filter
  const levels = deriveLevels(stages, false, nextAction);
  assert.equal(levels.intentComplete.nextAction.stage, 'D4');
  const personas = derivePersonas(stages, levels);
  assert.equal(personas.productOwner.nextAction.stage, 'D4');
  assert.equal(personas.engineer.nextAction.stage, 'D2');
});

test('readiness (ADR-4126, AC-17502-4): acknowledged D3 engineer failure is absent from readyToBuild.blockedBy', () => {
  const stages = [
    { stage: 'D1', gate: 'define.brief', state: 'passed', checks: [] },
    { stage: 'D2', gate: 'define.skeleton', state: 'passed', checks: [] },
    {
      stage: 'D3', gate: 'define.shapes', state: 'acknowledged', checks: [
        { name: 'shapes:draftSettled', ok: false, over: 'delta', pass: 0, total: 2, failing: [{ id: 'TAC-1:i', why: 'draft' }], persona: 'engineer', question: 'q' },
      ],
    },
    { stage: 'D4', gate: 'define.stories', state: 'passed', checks: [] },
    { stage: 'D5', gate: 'define.crosscut', state: 'passed', checks: [] },
    { stage: 'D6', gate: 'define.consistency', state: 'passed', checks: [] },
    { stage: 'D7', gate: 'define.decisions', state: 'passed', checks: [] },
    { stage: 'D8', gate: 'define.freeze', state: 'passed', checks: [] },
  ];
  const levels = deriveLevels(stages, true, null);
  assert.equal(levels.readyToBuild.ok, true);
  assert.equal(levels.readyToBuild.blockedBy.length, 0);
  // L1 unaffected: PO blockers unchanged.
  assert.equal(levels.intentComplete.ok, true);
  assert.equal(levels.intentComplete.blockedBy.length, 0);
});

test('readiness (ADR-4126, AC-17502-1): PO ok + engineer failing => L1 ok, L2 not ok', () => {
  const stages = [
    { stage: 'D1', gate: 'define.brief', state: 'passed', checks: [] },
    {
      stage: 'D2', gate: 'define.skeleton', state: 'failing', checks: [
        { name: 'skeleton:reqShape', ok: false, over: 'delta', pass: 0, total: 1, failing: [{ id: 'REQ-1', why: 'x' }], persona: 'engineer', question: 'q' },
      ],
    },
    { stage: 'D3', gate: 'define.shapes', state: 'passed', checks: [] },
    { stage: 'D4', gate: 'define.stories', state: 'passed', checks: [] },
    { stage: 'D5', gate: 'define.crosscut', state: 'passed', checks: [] },
    { stage: 'D6', gate: 'define.consistency', state: 'passed', checks: [] },
    { stage: 'D7', gate: 'define.decisions', state: 'passed', checks: [] },
    { stage: 'D8', gate: 'define.freeze', state: 'passed', checks: [] },
  ];
  const nextAction = deriveNextAction(stages);
  const levels = deriveLevels(stages, false, nextAction);
  assert.equal(levels.intentComplete.ok, true);
  assert.equal(levels.readyToBuild.ok, false);
  assert.ok(levels.readyToBuild.blockedBy.length > 0);
});

test('readiness (ADR-4126): formatVerdictLines returns the section 2.3 wording', () => {
  // All ok case.
  const okResult = {
    tree: { currentTreeHash: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' },
    levels: {
      intentComplete: { ok: true, blockedBy: [], nextAction: null },
      readyToBuild: { ok: true, blockedBy: [], nextAction: null },
    },
  };
  const okLines = formatVerdictLines(okResult);
  assert.match(okLines.intentComplete, /Intent-complete: yes/);
  assert.match(okLines.readyToBuild, /Ready-to-build: yes\. Freezeable at 01234567\./);

  // Not-ok case: both PO and engineer blockers across D1 and D2.
  const notOkResult = {
    tree: { currentTreeHash: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' },
    levels: {
      intentComplete: {
        ok: false,
        blockedBy: [
          { stage: 'D1', check: 'brief:profile', persona: 'productOwner' },
        ],
        nextAction: null,
      },
      readyToBuild: {
        ok: false,
        blockedBy: [
          { stage: 'D1', check: 'brief:profile', persona: 'productOwner' },
          { stage: 'D2', check: 'skeleton:reqShape', persona: 'engineer' },
        ],
        nextAction: null,
      },
    },
  };
  const notOkLines = formatVerdictLines(notOkResult);
  assert.match(notOkLines.intentComplete, /Intent-complete: no; 1 question for the product owner \(D1\/brief:profile\)\./);
  assert.match(notOkLines.readyToBuild, /Ready-to-build: no; blocked on D1, D2 \(2 checks: 1 product owner, 1 engineer\)\./);
});
