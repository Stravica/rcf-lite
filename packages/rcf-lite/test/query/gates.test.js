// Unit tests for the DEFINE stage-gate check functions (REQ-174;
// proposal 2026-09-22 §2.4, §3.2 v3). Pure over hand-built TreeModel
// fixtures.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  INTERFACE_KINDS,
  STAGE_GATES,
  STAGE_ORDER,
  STAGE_SHORT_NAMES,
  checkD1Brief,
  checkD2Skeleton,
  checkD3Shapes,
  checkD4Stories,
  checkD5Crosscut,
  checkD6Consistency,
  checkD7Decisions,
  checkD8Freeze,
  foldState,
  parseAcClass,
  stagePolicy,
} from '../../src/query/gates.js';

// ---------------------------------------------------------------------------
// Test fixture helpers.
// ---------------------------------------------------------------------------

/** Build a minimal TreeModel-like fixture. */
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
  for (const req of tree.requirements) {
    tree.byId.set(req.reqId, req);
    tree.kindById.set(req.reqId, 'req');
  }
  for (const us of tree.userStories) {
    tree.byId.set(us.usId, us);
    tree.kindById.set(us.usId, 'userStory');
  }
  for (const tac of tree.tacs) {
    tree.byId.set(tac.tacId, tac);
    tree.kindById.set(tac.tacId, 'tac');
  }
  for (const adr of tree.adrs) {
    tree.byId.set(adr.adrId, adr);
    tree.kindById.set(adr.adrId, 'adr');
  }
  for (const fbs of tree.fbsItems) {
    tree.byId.set(fbs.fbsId, fbs);
    tree.kindById.set(fbs.fbsId, 'fbs');
    for (const acId of fbs.acIds ?? []) {
      const list = tree.fbsByAcId.get(acId) ?? [];
      list.push(fbs.fbsId);
      tree.fbsByAcId.set(acId, list);
    }
  }
  return tree;
}

/**
 * Assert every check in `stage.checks` has the section 2.4 shape.
 */
function assertCheckShape(stage) {
  assert.ok(typeof stage.stage === 'string');
  assert.ok(typeof stage.gate === 'string');
  assert.ok(['passed', 'failing', 'acknowledged', 'notApplicable'].includes(stage.state));
  assert.ok(Array.isArray(stage.checks));
  for (const c of stage.checks) {
    assert.ok(typeof c.name === 'string', `check.name: ${JSON.stringify(c)}`);
    assert.equal(typeof c.ok, 'boolean');
    assert.ok(c.over === 'delta' || c.over === 'tree', `check.over: ${c.over}`);
    assert.equal(typeof c.pass, 'number');
    assert.equal(typeof c.total, 'number');
    assert.ok(Array.isArray(c.failing));
    for (const f of c.failing) {
      assert.ok(typeof f.id === 'string');
      assert.ok(typeof f.why === 'string');
    }
    if (c.ok) assert.equal(c.failing.length, 0);
  }
}

// ---------------------------------------------------------------------------
// Structural / constant sanity.
// ---------------------------------------------------------------------------

test('gates: STAGE_ORDER, STAGE_GATES and STAGE_SHORT_NAMES cover every stage', () => {
  assert.deepEqual([...STAGE_ORDER], ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8']);
  for (const stage of STAGE_ORDER) {
    assert.ok(typeof STAGE_GATES[stage] === 'string');
    assert.ok(typeof STAGE_SHORT_NAMES[stage] === 'string');
  }
});

test('gates: INTERFACE_KINDS lists the proposal §5.2 closed vocabulary', () => {
  assert.deepEqual([...INTERFACE_KINDS], [
    'recordShape', 'httpRoute', 'event', 'cliCommand', 'uiRoute',
    'port', 'fileFormat', 'fixture', 'other',
  ]);
});

test('gates: parseAcClass extracts the [failure|must-not|happy|edge|non-functional] prefix', () => {
  assert.equal(parseAcClass({ description: '[failure] server returns 500 on X' }), 'failure');
  assert.equal(parseAcClass({ description: '[must-not] the endpoint accepts unauth' }), 'must-not');
  assert.equal(parseAcClass({ description: '[happy] user logs in' }), 'happy');
  assert.equal(parseAcClass({ description: 'a bare description' }), null);
  assert.equal(parseAcClass(null), null);
});

// ---------------------------------------------------------------------------
// AC-17401-1: every check function returns the section 2.4 shape.
// ---------------------------------------------------------------------------

test('gates: every check function returns the section 2.4 shape', () => {
  const emptyLedgers = { brief: { statements: [] }, decisions: { decisions: [] }, concerns: { concerns: [] }, probes: { probes: [] } };
  const tree = makeTree();
  const ctx = {
    tree,
    ledgers: emptyLedgers,
    delta: { frozen: false, changed: [], added: [], removed: [], briefSince: [], unchanged: 0, currentTreeHash: 'sha256:aaaa', frozenAt: null, treeHash: null },
    freeze: null,
    scope: new Set(),
    validateErrors: [],
    profileText: 'productOwner viewer',
    profile: undefined,
    currentTreeHash: 'sha256:aaaa',
    priorStages: [],
  };
  for (const fn of [checkD1Brief, checkD2Skeleton, checkD3Shapes, checkD4Stories, checkD5Crosscut, checkD6Consistency, checkD7Decisions, checkD8Freeze]) {
    const stage = fn(ctx);
    assertCheckShape(stage);
  }
});

test('gates: stagePolicy names blocking-vs-warnWithAck per ADR-4122', () => {
  for (const s of ['D1', 'D2', 'D4', 'D7', 'D8']) assert.equal(stagePolicy(s), 'blocking');
  for (const s of ['D3', 'D5', 'D6']) assert.equal(stagePolicy(s), 'warnWithAck');
});

// ---------------------------------------------------------------------------
// AC-17401-2: warn-with-ack fold honours freeze.gates acknowledgement.
// ---------------------------------------------------------------------------

test('gates: warn-with-ack fold honours freeze.gates acknowledgement at the current hash', () => {
  const checks = [
    { name: 'shapes:tacHasInterface', ok: false, over: 'delta', pass: 0, total: 1, failing: [{ id: 'TAC-1', why: 'no interfaces' }] },
  ];
  // Not acknowledged -> failing.
  const s1 = foldState('D3', 'define.shapes', checks, { currentTreeHash: 'sha256:aaa', freezeGates: {} });
  assert.equal(s1.state, 'failing');
  // Acknowledged at a different hash -> failing.
  const s2 = foldState('D3', 'define.shapes', checks, {
    currentTreeHash: 'sha256:aaa',
    freezeGates: { 'define.shapes': { state: 'acknowledged', at: { hash: 'sha256:zzz' } } },
  });
  assert.equal(s2.state, 'failing');
  // Acknowledged at the current hash -> acknowledged.
  const s3 = foldState('D3', 'define.shapes', checks, {
    currentTreeHash: 'sha256:aaa',
    freezeGates: { 'define.shapes': { state: 'acknowledged', at: { hash: 'sha256:aaa' } } },
  });
  assert.equal(s3.state, 'acknowledged');
  // Blocking stage never flips to acknowledged.
  const s4 = foldState('D4', 'define.stories', checks, {
    currentTreeHash: 'sha256:aaa',
    freezeGates: { 'define.stories': { state: 'acknowledged', at: { hash: 'sha256:aaa' } } },
  });
  assert.equal(s4.state, 'failing');
});

// ---------------------------------------------------------------------------
// AC-17401-3: notApplicable decision per stage.
// ---------------------------------------------------------------------------

test('gates: notApplicable decision per stage', () => {
  const emptyLedgers = { brief: { statements: [] }, decisions: { decisions: [] }, concerns: { concerns: [] }, probes: { probes: [] } };
  const tree = makeTree();
  const baseCtx = {
    tree,
    ledgers: emptyLedgers,
    delta: { frozen: true, changed: [], added: [], removed: [], briefSince: [], unchanged: 0, currentTreeHash: 'sha256:aaaa', frozenAt: null, treeHash: null },
    freeze: { briefStatements: 0 },
    scope: new Set(),
    validateErrors: [],
    profileText: 'productOwner viewer',
    currentTreeHash: 'sha256:aaaa',
  };
  // D2 notApplicable when no resolving statement and no REQ/PRD/TAD in scope.
  assert.equal(checkD2Skeleton(baseCtx).state, 'notApplicable');
  // D3 notApplicable when no TAC and no shaped REQ in scope.
  assert.equal(checkD3Shapes(baseCtx).state, 'notApplicable');
  // D5 notApplicable when no REQ in scope.
  assert.equal(checkD5Crosscut(baseCtx).state, 'notApplicable');
  // D4 notApplicable when scope has no REQ and no US.
  assert.equal(checkD4Stories(baseCtx).state, 'notApplicable');
  // D7 notApplicable when no open decisions + skipReviewFor + one-doc delta.
  const oneDocCtx = {
    ...baseCtx,
    delta: { ...baseCtx.delta, added: ['REQ-1'] },
    profile: { skipReviewFor: 'singleDocument' },
  };
  assert.equal(checkD7Decisions(oneDocCtx).state, 'notApplicable');
  // D1 and D8 never notApplicable.
  assert.notEqual(checkD1Brief(baseCtx).state, 'notApplicable');
  assert.notEqual(checkD8Freeze({ ...baseCtx, priorStages: [] }).state, 'notApplicable');
});

// ---------------------------------------------------------------------------
// AC-17401-4: D4 floors and per-class opt-outs.
// ---------------------------------------------------------------------------

test('gates: D4 floors and per-class opt-outs', () => {
  const emptyLedgers = { brief: { statements: [] }, decisions: { decisions: [] }, concerns: { concerns: [] }, probes: { probes: [] } };
  const tac = { tacId: 'TAC-1', interfaces: [{ name: 'i', kind: 'httpRoute' }] };
  const req = { reqId: 'REQ-1', title: 'req', description: 'x', domain: 'x', shapeClassification: { shapes: [] } };
  const usBad = {
    usId: 'US-1', reqId: 'REQ-1', tacIds: ['TAC-1'],
    acceptanceCriteria: [
      { id: 'AC-1', testable: true, description: '[happy] user does the thing' },
    ],
  };
  const usGood = {
    usId: 'US-2', reqId: 'REQ-1', tacIds: ['TAC-1'],
    acceptanceCriteria: [
      { id: 'AC-2', testable: true, description: '[happy] user does the thing' },
      { id: 'AC-3', testable: true, description: '[failure] server returns 500' },
      { id: 'AC-4', testable: true, description: '[must-not] endpoint accepts unauth' },
    ],
  };
  const tree1 = makeTree({ requirements: [req], userStories: [usBad, usGood], tacs: [tac] });
  const stage1 = checkD4Stories({
    tree: tree1, ledgers: emptyLedgers, scope: new Set(['REQ-1', 'US-1', 'US-2']),
    validateErrors: [], currentTreeHash: 'sha256:aaa',
  });
  assert.equal(stage1.state, 'failing');
  const floorCheck = stage1.checks.find((c) => c.name === 'stories:usFloors');
  assert.ok(floorCheck);
  // usBad fails failure + must-not; usGood passes.
  const failingUs1 = floorCheck.failing.filter((f) => f.id === 'US-1');
  assert.ok(failingUs1.some((f) => /failure/.test(f.why)));
  assert.ok(failingUs1.some((f) => /must-not/.test(f.why)));
  assert.equal(floorCheck.failing.filter((f) => f.id === 'US-2').length, 0);

  // Opt-out via manifest.baselineAcOptOuts[] project-scoped clears the floor.
  const manifest = {
    baselineAcOptOuts: [
      { id: 'boo-2026-09-24-001', baselineKey: 'defineD4:failure', scope: 'project', reason: 'legacy stories exempt from the failure-class floor for this train' },
      { id: 'boo-2026-09-24-002', baselineKey: 'defineD4:mustNot', scope: 'req', reqId: 'REQ-1', reason: 'REQ-1 has no must-not surface applicable to it right now' },
    ],
  };
  const tree2 = makeTree({ manifest, requirements: [req], userStories: [usBad], tacs: [tac] });
  const stage2 = checkD4Stories({
    tree: tree2, ledgers: emptyLedgers, scope: new Set(['REQ-1', 'US-1']),
    validateErrors: [], currentTreeHash: 'sha256:aaa',
  });
  const floor2 = stage2.checks.find((c) => c.name === 'stories:usFloors');
  assert.equal(floor2.failing.filter((f) => f.id === 'US-1').length, 0);

  // Scaffold TODO placeholder in a description is a failure.
  // The literal scaffold shape (init.js / writer.js) is "TODO:" with a
  // colon; the check is case-sensitive so incidental prose like the
  // word "todo" or "the TODO placeholder pattern" does NOT trip.
  const usTodo = {
    usId: 'US-3', reqId: 'REQ-1', tacIds: ['TAC-1'],
    acceptanceCriteria: [
      { id: 'AC-9', testable: true, description: '[happy] TODO: describe the first acceptance criterion' },
      { id: 'AC-10', testable: true, description: '[failure] x' },
      { id: 'AC-11', testable: true, description: '[must-not] x' },
    ],
  };
  const tree3 = makeTree({ requirements: [req], userStories: [usTodo], tacs: [tac] });
  const stage3 = checkD4Stories({
    tree: tree3, ledgers: emptyLedgers, scope: new Set(['REQ-1', 'US-3']),
    validateErrors: [], currentTreeHash: 'sha256:aaa',
  });
  const floor3 = stage3.checks.find((c) => c.name === 'stories:usFloors');
  assert.ok(floor3.failing.some((f) => /TODO/.test(f.why)));

  // Incidental prose that mentions "TODO" or "todo" without the
  // scaffold colon shape does NOT trip the gate.
  const usProse = {
    usId: 'US-5', reqId: 'REQ-1', tacIds: ['TAC-1'],
    acceptanceCriteria: [
      { id: 'AC-15', testable: true, description: '[happy] no AC description contains the scaffold TODO placeholder' },
      { id: 'AC-16', testable: true, description: '[failure] x' },
      { id: 'AC-17', testable: true, description: '[must-not] x' },
    ],
  };
  const tree5 = makeTree({ requirements: [req], userStories: [usProse], tacs: [tac] });
  const stage5 = checkD4Stories({
    tree: tree5, ledgers: emptyLedgers, scope: new Set(['REQ-1', 'US-5']),
    validateErrors: [], currentTreeHash: 'sha256:aaa',
  });
  const floor5 = stage5.checks.find((c) => c.name === 'stories:usFloors');
  assert.equal(floor5.failing.filter((f) => f.id === 'US-5' && /TODO/.test(f.why)).length, 0);

  // Unresolved tacId is a failure.
  const usBadTac = {
    usId: 'US-4', reqId: 'REQ-1', tacIds: ['TAC-DOES-NOT-EXIST'],
    acceptanceCriteria: [
      { id: 'AC-12', testable: true, description: '[happy] x' },
      { id: 'AC-13', testable: true, description: '[failure] x' },
      { id: 'AC-14', testable: true, description: '[must-not] x' },
    ],
  };
  const tree4 = makeTree({ requirements: [req], userStories: [usBadTac], tacs: [tac] });
  const stage4 = checkD4Stories({
    tree: tree4, ledgers: emptyLedgers, scope: new Set(['REQ-1', 'US-4']),
    validateErrors: [], currentTreeHash: 'sha256:aaa',
  });
  const floor4 = stage4.checks.find((c) => c.name === 'stories:usFloors');
  assert.ok(floor4.failing.some((f) => /tacIds names non-TAC/.test(f.why)));
});

// ---------------------------------------------------------------------------
// AC-17401-5: D3 interface presence and kind vocabulary.
// ---------------------------------------------------------------------------

test('gates: D3 interface presence and kind vocabulary', () => {
  const emptyLedgers = { brief: { statements: [] }, decisions: { decisions: [] }, concerns: { concerns: [] }, probes: { probes: [] } };
  const req = { reqId: 'REQ-1', title: 'req', shapeClassification: { shapes: ['httpApi'] } };
  const tacNoIface = { tacId: 'TAC-1', interfaces: [] };
  const tacBadKind = { tacId: 'TAC-2', interfaces: [{ name: 'i', kind: 'notInVocabulary' }] };
  const tacGood = { tacId: 'TAC-3', interfaces: [{ name: 'i', kind: 'httpRoute' }, { name: 'e', kind: 'event' }] };
  const tree = makeTree({ requirements: [req], tacs: [tacNoIface, tacBadKind, tacGood] });
  const scope = new Set(['TAC-1', 'TAC-2', 'TAC-3', 'REQ-1']);
  const stage = checkD3Shapes({
    tree, ledgers: emptyLedgers, scope,
    validateErrors: [], currentTreeHash: 'sha256:aaa',
  });
  assert.equal(stage.state, 'failing');
  const ifaceCheck = stage.checks.find((c) => c.name === 'shapes:tacHasInterface');
  assert.ok(ifaceCheck.failing.some((f) => f.id === 'TAC-1'));
  const kindCheck = stage.checks.find((c) => c.name === 'shapes:kindVocabulary');
  assert.ok(kindCheck.failing.some((f) => /unknown interface kind/.test(f.why)));
});

// ---------------------------------------------------------------------------
// AC-17401-6: D5 crosscut cheap checks.
// ---------------------------------------------------------------------------

test('gates: D5 crosscut cheap checks', () => {
  const emptyLedgers = { brief: { statements: [] }, decisions: { decisions: [] }, concerns: { concerns: [] }, probes: { probes: [] } };
  const req = { reqId: 'REQ-1', title: 'req', shapeClassification: { shapes: ['auth'] } };
  const usDeployed = {
    usId: 'US-1', reqId: 'REQ-1',
    acceptanceCriteria: [{ id: 'AC-1', testable: true, description: '[deployed] service ships behind a proxy' }],
  };
  const tadEmpty = { tadId: 'TAD-1', securityArchitecture: '', operationalConcerns: '' };
  const tree = makeTree({ requirements: [req], userStories: [usDeployed], tad: tadEmpty });
  const stage = checkD5Crosscut({
    tree, ledgers: emptyLedgers, scope: new Set(['REQ-1']),
    validateErrors: [], currentTreeHash: 'sha256:aaa',
  });
  assert.equal(stage.state, 'failing');
  assert.ok(stage.checks.some((c) => c.name === 'crosscut:securityArchitecture' && !c.ok));
  assert.ok(stage.checks.some((c) => c.name === 'crosscut:operationalConcerns' && !c.ok));

  // Open concern on a REQ in scope.
  const ledgersOpen = { brief: { statements: [] }, decisions: { decisions: [] }, concerns: { concerns: [{ id: 1, reqId: 'REQ-1', concern: 'audit-logging', disposition: 'applied', status: 'open', addedAt: '2026-09-24T10:00:00Z' }] }, probes: { probes: [] } };
  const stage2 = checkD5Crosscut({
    tree, ledgers: ledgersOpen, scope: new Set(['REQ-1']),
    validateErrors: [], currentTreeHash: 'sha256:aaa',
  });
  assert.ok(stage2.checks.some((c) => c.name === 'crosscut:concernsResolved' && c.failing.length > 0));
});

// ---------------------------------------------------------------------------
// AC-17401-7: D6 consistency validate + probe count.
// ---------------------------------------------------------------------------

test('gates: D6 consistency validate + probe count', () => {
  const emptyLedgers = { brief: { statements: [] }, decisions: { decisions: [] }, concerns: { concerns: [] }, probes: { probes: [{ id: 1, reqId: 'REQ-1', finding: 'not applicable', severity: 'low', status: 'open', addedAt: '2026-09-24T10:00:00Z' }] } };
  const tree = makeTree();
  const stage = checkD6Consistency({
    tree, ledgers: emptyLedgers, scope: new Set(),
    validateErrors: [{ documentId: 'REQ-1', message: 'broken ref' }], currentTreeHash: 'sha256:aaa',
  });
  assert.equal(stage.state, 'failing');
  assert.ok(stage.checks.some((c) => c.name === 'consistency:validateClean' && c.failing.length > 0));
  assert.ok(stage.checks.some((c) => c.name === 'consistency:probeCount' && c.failing.length > 0));

  // Clean tree, no probes -> passed.
  const ledgersClean = { brief: { statements: [] }, decisions: { decisions: [] }, concerns: { concerns: [] }, probes: { probes: [] } };
  const stage2 = checkD6Consistency({
    tree, ledgers: ledgersClean, scope: new Set(),
    validateErrors: [], currentTreeHash: 'sha256:aaa',
  });
  assert.equal(stage2.state, 'passed');

  // Beyond-20 failures: the failing array is truncated to 20 items
  // for display, but `pass` folds from the untruncated count so
  // pass=0 (not total-20) and ok stays false.
  const manyErrors = Array.from({ length: 25 }, (_, i) => ({ documentId: `DOC-${i + 1}`, message: 'validate error' }));
  const stage3 = checkD6Consistency({
    tree, ledgers: ledgersClean, scope: new Set(),
    validateErrors: manyErrors, currentTreeHash: 'sha256:aaa',
  });
  const validateCheck = stage3.checks.find((c) => c.name === 'consistency:validateClean');
  assert.equal(validateCheck.total, 25);
  assert.equal(validateCheck.pass, 0);
  assert.equal(validateCheck.ok, false);
  assert.equal(validateCheck.failing.length, 20);

  // Beyond-20 probes (bundle-scan path): same story.
  const manyProbes = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, reqId: `REQ-${i + 1}`, finding: 'x', severity: 'low', status: 'open', addedAt: '2026-09-24T10:00:00Z' }));
  const stage4 = checkD6Consistency({
    tree, ledgers: { brief: { statements: [] }, decisions: { decisions: [] }, concerns: { concerns: [] }, probes: { probes: manyProbes } }, scope: new Set(),
    validateErrors: [], currentTreeHash: 'sha256:aaa',
  });
  const probeCheck = stage4.checks.find((c) => c.name === 'consistency:probeCount');
  assert.equal(probeCheck.total, 30);
  assert.equal(probeCheck.pass, 0);
  assert.equal(probeCheck.ok, false);
  assert.equal(probeCheck.failing.length, 20);
});

// ---------------------------------------------------------------------------
// AC-17401-8: D8 tree-wide freeze checks.
// ---------------------------------------------------------------------------

test('gates: D8 tree-wide freeze checks', () => {
  const emptyLedgers = { brief: { statements: [] }, decisions: { decisions: [] }, concerns: { concerns: [] }, probes: { probes: [] } };
  const us = { usId: 'US-1', reqId: 'REQ-1', acceptanceCriteria: [{ id: 'AC-1' }] };
  const fbsA = { fbsId: 'FBS-1', acIds: ['AC-1'], executionStatus: 'notStarted', dependsOnFbsIds: [], title: 'ship' };
  const fbsB = { fbsId: 'FBS-2', acIds: ['AC-1'], executionStatus: 'notStarted', dependsOnFbsIds: [], title: 'ship again' };
  const treeDouble = makeTree({ userStories: [us], fbsItems: [fbsA, fbsB] });
  const stage = checkD8Freeze({
    tree: treeDouble, ledgers: emptyLedgers, scope: new Set(),
    validateErrors: [], currentTreeHash: 'sha256:aaa',
    priorStages: [
      { stage: 'D1', state: 'passed' }, { stage: 'D2', state: 'passed' },
      { stage: 'D3', state: 'acknowledged' }, { stage: 'D4', state: 'passed' },
      { stage: 'D5', state: 'notApplicable' }, { stage: 'D6', state: 'passed' },
      { stage: 'D7', state: 'passed' },
    ],
  });
  // Double AC ownership fails ownership check.
  assert.ok(stage.checks.some((c) => c.name === 'freeze:acFbsOwnership' && c.failing.length > 0));

  // Prior stage failing surfaces in priorGates.
  const stagePrior = checkD8Freeze({
    tree: makeTree(), ledgers: emptyLedgers, scope: new Set(),
    validateErrors: [], currentTreeHash: 'sha256:aaa',
    priorStages: [
      { stage: 'D1', state: 'failing' }, { stage: 'D2', state: 'passed' },
    ],
  });
  assert.ok(stagePrior.checks.some((c) => c.name === 'freeze:priorGates' && c.failing.some((f) => f.id === 'D1')));

  // Queue head placeholder fails.
  const usSingle = { usId: 'US-1', reqId: 'REQ-1', acceptanceCriteria: [{ id: 'AC-1' }] };
  const fbsPlaceholder = { fbsId: 'FBS-1', acIds: ['AC-1'], executionStatus: 'notStarted', dependsOnFbsIds: [], title: 'TODO' };
  const treePlaceholder = makeTree({ userStories: [usSingle], fbsItems: [fbsPlaceholder] });
  const stageHead = checkD8Freeze({
    tree: treePlaceholder, ledgers: emptyLedgers, scope: new Set(),
    validateErrors: [], currentTreeHash: 'sha256:aaa',
    priorStages: [],
  });
  assert.ok(stageHead.checks.some((c) => c.name === 'freeze:queueHead' && c.failing.length > 0));

  // Beyond-20 validate errors: failing array truncated to 20 but
  // `pass` folds from the untruncated count.
  const manyErrors = Array.from({ length: 25 }, (_, i) => ({ documentId: `DOC-${i + 1}`, message: 'validate error' }));
  const stageMany = checkD8Freeze({
    tree: makeTree(), ledgers: emptyLedgers, scope: new Set(),
    validateErrors: manyErrors, currentTreeHash: 'sha256:aaa',
    priorStages: [],
  });
  const validateCheck = stageMany.checks.find((c) => c.name === 'freeze:validateClean');
  assert.equal(validateCheck.total, 25);
  assert.equal(validateCheck.pass, 0);
  assert.equal(validateCheck.ok, false);
  assert.equal(validateCheck.failing.length, 20);
});

// ---------------------------------------------------------------------------
// AC-17401-9: checkD2Skeleton reads tad.dataArchitecture.{dataStores,coreEntities}
// (not top-level) per rcf-schemas 0.6.3. w-2026-09-25-dave-004 defect A.
// ---------------------------------------------------------------------------

test('gates: D2 skeleton:tadPersistence reads tad.dataArchitecture.* per schema 0.6.3', () => {
  const emptyLedgers = {
    brief: { statements: [] },
    decisions: { decisions: [] },
    concerns: { concerns: [] },
    probes: { probes: [] },
  };
  const persistenceReq = {
    reqId: 'REQ-P',
    title: 'persistence',
    description: 'x',
    domain: 'd',
    shapeClassification: { shapes: ['persistence'] },
  };
  const deployAdr = { adrId: 'ADR-D', title: 'Deploy target: fly.io' };
  const baseCtx = {
    ledgers: emptyLedgers,
    delta: { frozen: true, changed: [], added: ['REQ-P'], removed: [], briefSince: [], unchanged: 0, currentTreeHash: 'sha256:bbb', frozenAt: null, treeHash: null },
    freeze: { briefStatements: 0 },
    scope: new Set(['REQ-P']),
    validateErrors: [],
    profileText: 'productOwner viewer',
    currentTreeHash: 'sha256:bbb',
  };

  // Case 1: dataArchitecture populated correctly → tadPersistence passes.
  const tadGood = {
    dataArchitecture: {
      dataStores: [{ name: 'main', kind: 'relational' }],
      coreEntities: [{ name: 'Thing' }],
    },
  };
  const treeGood = makeTree({ requirements: [persistenceReq], tad: tadGood, adrs: [deployAdr] });
  const stageGood = checkD2Skeleton({ ...baseCtx, tree: treeGood });
  const persistenceCheckGood = stageGood.checks.find((c) => c.name === 'skeleton:tadPersistence');
  assert.ok(persistenceCheckGood, 'skeleton:tadPersistence check missing');
  assert.equal(persistenceCheckGood.ok, true, `expected tadPersistence ok, got failing=${JSON.stringify(persistenceCheckGood.failing)}`);
  assert.equal(persistenceCheckGood.failing.length, 0);

  // Case 2: dataArchitecture present but arrays empty → fails with the
  // new schema-anchored ids.
  const tadEmpty = { dataArchitecture: { dataStores: [], coreEntities: [] } };
  const treeEmpty = makeTree({ requirements: [persistenceReq], tad: tadEmpty, adrs: [deployAdr] });
  const stageEmpty = checkD2Skeleton({ ...baseCtx, tree: treeEmpty });
  const persistenceCheckEmpty = stageEmpty.checks.find((c) => c.name === 'skeleton:tadPersistence');
  assert.equal(persistenceCheckEmpty.ok, false);
  const idsEmpty = persistenceCheckEmpty.failing.map((f) => f.id).sort();
  assert.deepEqual(idsEmpty, ['TAD.dataArchitecture.coreEntities', 'TAD.dataArchitecture.dataStores']);

  // Case 3: no dataArchitecture at all → both ids fail.
  const treeNone = makeTree({ requirements: [persistenceReq], tad: {}, adrs: [deployAdr] });
  const stageNone = checkD2Skeleton({ ...baseCtx, tree: treeNone });
  const persistenceCheckNone = stageNone.checks.find((c) => c.name === 'skeleton:tadPersistence');
  assert.equal(persistenceCheckNone.ok, false);
  const idsNone = persistenceCheckNone.failing.map((f) => f.id).sort();
  assert.deepEqual(idsNone, ['TAD.dataArchitecture.coreEntities', 'TAD.dataArchitecture.dataStores']);

  // Guard: a TAD with the (wrong) top-level dataStores+coreEntities
  // but no dataArchitecture must FAIL — the schema path is the only
  // one honoured.
  const tadDrift = {
    dataStores: [{ name: 'top-level', kind: 'relational' }],
    coreEntities: [{ name: 'DriftThing' }],
  };
  const treeDrift = makeTree({ requirements: [persistenceReq], tad: tadDrift, adrs: [deployAdr] });
  const stageDrift = checkD2Skeleton({ ...baseCtx, tree: treeDrift });
  const persistenceCheckDrift = stageDrift.checks.find((c) => c.name === 'skeleton:tadPersistence');
  assert.equal(persistenceCheckDrift.ok, false, 'top-level dataStores/coreEntities must not satisfy the schema-anchored check');
});

// ---------------------------------------------------------------------------
// ADR-4126 (US-17402): every check carries persona + question.
// ---------------------------------------------------------------------------

import {
  CHECK_PERSONA,
  CHECK_QUESTION,
  STAGE_FALLBACK_PERSONA,
  checkPersona,
  checkQuestion,
  parseInterfaceDraft,
} from '../../src/query/gates.js';

/** The 24 ADR-4126 check names (0.29.0). */
const EXPECTED_CHECK_NAMES = [
  'brief:sinceFreeze', 'brief:kinds', 'brief:openQuestions', 'brief:profile',
  'skeleton:resolvedBy', 'skeleton:reqIntent', 'skeleton:reqShape',
  'skeleton:tadPersistence', 'skeleton:deployAdr',
  'shapes:tacHasInterface', 'shapes:kindVocabulary', 'shapes:draftSettled',
  'stories:reqHasUs', 'stories:usFloors',
  'crosscut:securityArchitecture', 'crosscut:operationalConcerns', 'crosscut:concernsResolved',
  'consistency:validateClean', 'consistency:probeCount',
  'decisions:wellFormed', 'decisions:allAnswered',
  'freeze:priorGates', 'freeze:acFbsOwnership', 'freeze:queueHead', 'freeze:validateClean',
];

test('gates (ADR-4126): CHECK_PERSONA and CHECK_QUESTION cover every check name', () => {
  assert.deepEqual(Object.keys(CHECK_PERSONA).sort(), [...EXPECTED_CHECK_NAMES].sort());
  assert.deepEqual(Object.keys(CHECK_QUESTION).sort(), [...EXPECTED_CHECK_NAMES].sort());
  for (const name of EXPECTED_CHECK_NAMES) {
    const persona = CHECK_PERSONA[name];
    assert.ok(persona === 'productOwner' || persona === 'engineer', `${name}: persona ${persona}`);
    assert.equal(typeof CHECK_QUESTION[name], 'string');
    assert.ok(CHECK_QUESTION[name].length > 0, `${name}: question`);
  }
});

test('gates (ADR-4126): checkPersona / checkQuestion helpers mirror the maps', () => {
  for (const name of EXPECTED_CHECK_NAMES) {
    assert.equal(checkPersona(name), CHECK_PERSONA[name]);
    assert.equal(checkQuestion(name), CHECK_QUESTION[name]);
  }
  assert.equal(checkPersona('bogus:name'), null);
  assert.equal(checkQuestion('bogus:name'), '');
});

test('gates (ADR-4126): STAGE_FALLBACK_PERSONA covers every stage', () => {
  for (const stage of ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8']) {
    const v = STAGE_FALLBACK_PERSONA[stage];
    assert.ok(v === 'productOwner' || v === 'engineer', `${stage}: ${v}`);
  }
});

test('gates (ADR-4126, AC-17402-1): every check carries persona + question', () => {
  const emptyLedgers = { brief: { statements: [] }, decisions: { decisions: [] }, concerns: { concerns: [] }, probes: { probes: [] } };
  const tree = makeTree();
  const ctx = {
    tree,
    ledgers: emptyLedgers,
    delta: { frozen: false, changed: [], added: [], removed: [], briefSince: [], unchanged: 0, currentTreeHash: 'sha256:aaaa', frozenAt: null, treeHash: null },
    freeze: null,
    scope: new Set(),
    validateErrors: [],
    profileText: 'productOwner viewer',
    profile: undefined,
    currentTreeHash: 'sha256:aaaa',
    priorStages: [],
  };
  for (const fn of [checkD1Brief, checkD2Skeleton, checkD3Shapes, checkD4Stories, checkD5Crosscut, checkD6Consistency, checkD7Decisions, checkD8Freeze]) {
    const stage = fn(ctx);
    for (const c of stage.checks) {
      assert.ok(c.persona === 'productOwner' || c.persona === 'engineer',
        `${stage.stage}/${c.name}: persona ${c.persona}`);
      assert.equal(typeof c.question, 'string');
      assert.ok(c.question.length > 0, `${stage.stage}/${c.name}: question`);
    }
  }
});

test('gates (ADR-4126, AC-17402-7): notApplicable placeholder carries stage fallback persona and ok true', () => {
  const emptyLedgers = { brief: { statements: [] }, decisions: { decisions: [] }, concerns: { concerns: [] }, probes: { probes: [] } };
  const tree = makeTree();
  // D2 goes notApplicable with no resolving statements and no REQ/PRD/TAD in scope.
  const stage = checkD2Skeleton({
    tree, ledgers: emptyLedgers, scope: new Set(),
    delta: { frozen: false, changed: [], added: [], removed: [], briefSince: [] },
    freeze: null, validateErrors: [], profileText: '', currentTreeHash: 'sha256:aaa',
  });
  assert.equal(stage.state, 'notApplicable');
  assert.equal(stage.checks.length, 1);
  const placeholder = stage.checks[0];
  assert.equal(placeholder.name, 'stage:D2:scope');
  assert.equal(placeholder.ok, true);
  assert.equal(placeholder.persona, STAGE_FALLBACK_PERSONA.D2);
  assert.equal(typeof placeholder.question, 'string');
});

// ---------------------------------------------------------------------------
// ADR-4126 (US-17403, AC-17403-1 / 2 / 8): skeleton:reqFields split.
// ---------------------------------------------------------------------------

test('gates (ADR-4126, AC-17403-1): TODO description + missing shapes fails BOTH reqIntent AND reqShape on same REQ', () => {
  const emptyLedgers = { brief: { statements: [] }, decisions: { decisions: [] }, concerns: { concerns: [] }, probes: { probes: [] } };
  const req = {
    reqId: 'REQ-TODO', title: 'x',
    description: 'TODO: write me', domain: 'x',
    // No shapeClassification.
  };
  const deployAdr = { adrId: 'ADR-D', title: 'Deploy target: fly.io' };
  const tree = makeTree({ requirements: [req], adrs: [deployAdr] });
  const stage = checkD2Skeleton({
    tree, ledgers: emptyLedgers, scope: new Set(['REQ-TODO']),
    delta: { frozen: false, changed: [], added: ['REQ-TODO'], removed: [], briefSince: [] },
    freeze: null, validateErrors: [], profileText: 'productOwner viewer', currentTreeHash: 'sha256:aaa',
  });
  const intent = stage.checks.find((c) => c.name === 'skeleton:reqIntent');
  const shape = stage.checks.find((c) => c.name === 'skeleton:reqShape');
  assert.ok(intent, 'skeleton:reqIntent should exist');
  assert.ok(shape, 'skeleton:reqShape should exist');
  assert.ok(intent.failing.some((f) => f.id === 'REQ-TODO' && /description/.test(f.why)));
  assert.ok(shape.failing.some((f) => f.id === 'REQ-TODO' && /shapeClassification/.test(f.why)));
  assert.equal(intent.persona, 'productOwner');
  assert.equal(shape.persona, 'engineer');
});

test('gates (ADR-4126, AC-17403-2): shapes present + no domain fails reqIntent only', () => {
  const emptyLedgers = { brief: { statements: [] }, decisions: { decisions: [] }, concerns: { concerns: [] }, probes: { probes: [] } };
  const req = {
    reqId: 'REQ-NODOM', title: 'x',
    description: 'a real description',
    shapeClassification: { shapes: ['httpApi'] },
    // No domain.
  };
  const deployAdr = { adrId: 'ADR-D', title: 'Deploy target: fly.io' };
  const tree = makeTree({ requirements: [req], adrs: [deployAdr] });
  const stage = checkD2Skeleton({
    tree, ledgers: emptyLedgers, scope: new Set(['REQ-NODOM']),
    delta: { frozen: false, changed: [], added: ['REQ-NODOM'], removed: [], briefSince: [] },
    freeze: null, validateErrors: [], profileText: 'productOwner viewer', currentTreeHash: 'sha256:aaa',
  });
  const intent = stage.checks.find((c) => c.name === 'skeleton:reqIntent');
  const shape = stage.checks.find((c) => c.name === 'skeleton:reqShape');
  assert.ok(intent.failing.some((f) => f.id === 'REQ-NODOM' && /domain missing/.test(f.why)));
  assert.equal(shape.failing.filter((f) => f.id === 'REQ-NODOM').length, 0);
});

test('gates (ADR-4126, AC-17403-8): no check named skeleton:reqFields is emitted', () => {
  const emptyLedgers = { brief: { statements: [] }, decisions: { decisions: [] }, concerns: { concerns: [] }, probes: { probes: [] } };
  const req = { reqId: 'REQ-1', title: 'x', description: 'live', domain: 'x', shapeClassification: { shapes: [] } };
  const deployAdr = { adrId: 'ADR-D', title: 'Deploy target: fly.io' };
  const tree = makeTree({ requirements: [req], adrs: [deployAdr] });
  const stage = checkD2Skeleton({
    tree, ledgers: emptyLedgers, scope: new Set(['REQ-1']),
    delta: { frozen: false, changed: [], added: ['REQ-1'], removed: [], briefSince: [] },
    freeze: null, validateErrors: [], profileText: 'productOwner viewer', currentTreeHash: 'sha256:aaa',
  });
  assert.equal(stage.checks.filter((c) => c.name === 'skeleton:reqFields').length, 0);
});

// ---------------------------------------------------------------------------
// ADR-4126 (US-17403, AC-17403-3 / 4 / 5): shapes:draftSettled.
// ---------------------------------------------------------------------------

test('gates (ADR-4126): parseInterfaceDraft respects leading whitespace', () => {
  assert.equal(parseInterfaceDraft({ description: '[draft] a route' }), true);
  assert.equal(parseInterfaceDraft({ description: '   [draft] a route' }), true);
  assert.equal(parseInterfaceDraft({ description: 'a bare one' }), false);
  assert.equal(parseInterfaceDraft({ description: '[happy] not a draft marker' }), false);
  assert.equal(parseInterfaceDraft({}), false);
  assert.equal(parseInterfaceDraft(null), false);
});

test('gates (ADR-4126, AC-17403-3 / 4): draft interface fails draftSettled, passes tacHasInterface', () => {
  const emptyLedgers = { brief: { statements: [] }, decisions: { decisions: [] }, concerns: { concerns: [] }, probes: { probes: [] } };
  const tacDraft = {
    tacId: 'TAC-D',
    interfaces: [{ name: 'ship', kind: 'httpRoute', description: '[draft] placeholder' }],
  };
  const tree = makeTree({ tacs: [tacDraft] });
  const stage = checkD3Shapes({
    tree, ledgers: emptyLedgers, scope: new Set(['TAC-D']),
    validateErrors: [], currentTreeHash: 'sha256:aaa',
  });
  const iface = stage.checks.find((c) => c.name === 'shapes:tacHasInterface');
  const draft = stage.checks.find((c) => c.name === 'shapes:draftSettled');
  assert.ok(iface.ok, 'tacHasInterface should pass a draft-only TAC');
  assert.equal(draft.failing.length, 1);
  assert.equal(draft.failing[0].id, 'TAC-D:ship');
  assert.match(draft.failing[0].why, /draft interface pre-populated/);

  // After the marker is removed, draftSettled passes.
  const tacSettled = {
    tacId: 'TAC-D',
    interfaces: [{ name: 'ship', kind: 'httpRoute', description: 'placeholder' }],
  };
  const tree2 = makeTree({ tacs: [tacSettled] });
  const stage2 = checkD3Shapes({
    tree: tree2, ledgers: emptyLedgers, scope: new Set(['TAC-D']),
    validateErrors: [], currentTreeHash: 'sha256:aaa',
  });
  assert.ok(stage2.checks.find((c) => c.name === 'shapes:draftSettled').ok);
});

test('gates (ADR-4126, AC-17403-5): kindVocabulary applies to drafts just like settled interfaces', () => {
  const emptyLedgers = { brief: { statements: [] }, decisions: { decisions: [] }, concerns: { concerns: [] }, probes: { probes: [] } };
  const tacDraftBadKind = {
    tacId: 'TAC-DK',
    interfaces: [{ name: 'ship', kind: 'notAVocab', description: '[draft] placeholder' }],
  };
  const tree = makeTree({ tacs: [tacDraftBadKind] });
  const stage = checkD3Shapes({
    tree, ledgers: emptyLedgers, scope: new Set(['TAC-DK']),
    validateErrors: [], currentTreeHash: 'sha256:aaa',
  });
  const kind = stage.checks.find((c) => c.name === 'shapes:kindVocabulary');
  assert.ok(kind.failing.some((f) => f.id === 'TAC-DK:ship'));
});

// ---------------------------------------------------------------------------
// ADR-4126 (US-17403, AC-17403-6 / 7): decisions:wellFormed vs allAnswered.
// ---------------------------------------------------------------------------

test('gates (ADR-4126, AC-17403-6): enumerated open decision passes wellFormed, fails allAnswered', () => {
  const ledgers = {
    brief: { statements: [] },
    decisions: {
      decisions: [{
        id: 1, status: 'open',
        question: 'Pick a store',
        options: [{ letter: 'A', text: 'postgres' }, { letter: 'B', text: 'sqlite' }],
        default: 'A',
      }],
    },
    concerns: { concerns: [] },
    probes: { probes: [] },
  };
  const tree = makeTree();
  const stage = checkD7Decisions({
    tree, ledgers, scope: new Set(),
    delta: { changed: [], added: [] },
    freeze: null, validateErrors: [], profileText: '',
    profile: {}, currentTreeHash: 'sha256:aaa',
  });
  const wf = stage.checks.find((c) => c.name === 'decisions:wellFormed');
  const aa = stage.checks.find((c) => c.name === 'decisions:allAnswered');
  assert.ok(wf.ok, 'wellFormed should pass');
  assert.ok(!aa.ok, 'allAnswered should fail');
  assert.ok(aa.failing.some((f) => f.id === 'decision:1'));
});

test('gates (ADR-4126, AC-17403-7): one option, no default fails wellFormed', () => {
  const ledgers = {
    brief: { statements: [] },
    decisions: {
      decisions: [{
        id: 2, status: 'open',
        question: 'Pick a store',
        options: [{ letter: 'A', text: 'postgres' }],
        default: null,
      }],
    },
    concerns: { concerns: [] },
    probes: { probes: [] },
  };
  const tree = makeTree();
  const stage = checkD7Decisions({
    tree, ledgers, scope: new Set(),
    delta: { changed: [], added: [] },
    freeze: null, validateErrors: [], profileText: '',
    profile: {}, currentTreeHash: 'sha256:aaa',
  });
  const wf = stage.checks.find((c) => c.name === 'decisions:wellFormed');
  assert.ok(!wf.ok);
  assert.ok(wf.failing.some((f) => f.id === 'decision:2' && /enumerated/.test(f.why)));
});
