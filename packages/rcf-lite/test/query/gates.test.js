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
  parseTacPurposeDraft,
  parseCoreEntityDraft,
  hasDraftMarker,
} from '../../src/query/gates.js';

/** The 32 check names (0.30.0 after ADR-4126 + ADR-4131 PR 5 D3 bites + PR 6 D4/D5/standards). */
const EXPECTED_CHECK_NAMES = [
  'brief:sinceFreeze', 'brief:kinds', 'brief:openQuestions', 'brief:profile',
  'skeleton:resolvedBy', 'skeleton:reqIntent', 'skeleton:reqShape',
  'skeleton:tadPersistence', 'skeleton:deployAdr', 'skeleton:standardsCited',
  'shapes:tacHasInterface', 'shapes:kindVocabulary', 'shapes:draftSettled',
  'shapes:templateMarkers', 'shapes:entityJoin', 'shapes:pathsResolve',
  'stories:reqHasUs', 'stories:usFloors', 'stories:closedSets', 'stories:ownerRefResolves',
  'crosscut:securityArchitecture', 'crosscut:operationalConcerns', 'crosscut:concernsResolved',
  'crosscut:catalogue',
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

// ---------------------------------------------------------------------------
// REQ-173 amendment (US-17302): skeleton:resolvedBy with the closed pointer
// grammar; the title-hit fallback is dropped in 0.30.0.
// ---------------------------------------------------------------------------

function resolvedByFixtureTree(extraReqs = []) {
  const req3 = { reqId: 'REQ-003', title: 'Loan hold', description: 'live', domain: 'd', shapeClassification: { shapes: [] } };
  return makeTree({
    requirements: [req3, ...extraReqs],
    tacs: [{ tacId: 'TAC-4130-define-intake-brief', interfaces: [{ name: 'x', kind: 'other', description: 'live' }] }],
    tad: {
      tadId: 'TAD-001',
      dataArchitecture: {
        dataStores: [{ name: 's' }],
        coreEntities: [{ name: 'Loan' }, { name: 'Officer' }],
      },
      externalSystems: [{ name: 'CoreBanking' }],
    },
    prd: { prdId: 'PRD-001', users: [{ name: 'LoanOfficer' }] },
    adrs: [{ adrId: 'ADR-D', title: 'Deploy target: fly.io' }],
  });
}

function resolvedByCtx(tree, statements) {
  return {
    tree,
    ledgers: {
      brief: { statements },
      decisions: { decisions: [] },
      concerns: { concerns: [] },
      probes: { probes: [] },
    },
    scope: new Set(),
    delta: { frozen: false, changed: [], added: [], removed: [], briefSince: [] },
    freeze: null,
    validateErrors: [],
    profileText: 'productOwner viewer',
    currentTreeHash: 'sha256:aaa',
  };
}

test('gates (REQ-173, AC-17302-3): each pointer form resolves on the fixture', () => {
  const tree = resolvedByFixtureTree();
  const statements = [
    { id: 1, kind: 'capability', text: 'req', resolvedBy: 'REQ-003', addedAt: '2026-10-02T10:00:00Z', status: 'open' },
    { id: 2, kind: 'capability', text: 'ent', resolvedBy: 'TAD.entity:Loan', addedAt: '2026-10-02T10:00:00Z', status: 'open' },
    { id: 3, kind: 'capability', text: 'usr', resolvedBy: 'PRD.user:LoanOfficer', addedAt: '2026-10-02T10:00:00Z', status: 'open' },
    { id: 4, kind: 'capability', text: 'sys', resolvedBy: 'TAD.system:CoreBanking', addedAt: '2026-10-02T10:00:00Z', status: 'open' },
    { id: 5, kind: 'capability', text: 'tac', resolvedBy: 'TAC-4130', addedAt: '2026-10-02T10:00:00Z', status: 'open' },
    { id: 6, kind: 'capability', text: 'omit', resolvedBy: 'omitted:out of scope', addedAt: '2026-10-02T10:00:00Z', status: 'open' },
  ];
  const stage = checkD2Skeleton(resolvedByCtx(tree, statements));
  const check = stage.checks.find((c) => c.name === 'skeleton:resolvedBy');
  assert.ok(check, 'skeleton:resolvedBy should exist');
  assert.ok(check.ok, `expected pass, failing=${JSON.stringify(check.failing)}`);
});

test('gates (REQ-173, AC-17302-5): REQ-999 fails with "pointer does not resolve"', () => {
  const tree = resolvedByFixtureTree();
  const statements = [
    { id: 1, kind: 'capability', text: 'dangling', resolvedBy: 'REQ-999', addedAt: '2026-10-02T10:00:00Z', status: 'open' },
  ];
  const stage = checkD2Skeleton(resolvedByCtx(tree, statements));
  const check = stage.checks.find((c) => c.name === 'skeleton:resolvedBy');
  assert.ok(!check.ok);
  assert.ok(check.failing.some((f) => f.id === 'brief:1' && /pointer does not resolve/.test(f.why)));
});

test('gates (REQ-173, AC-17302-6): a text-title hit alone does NOT pass in 0.30.0', () => {
  // REQ-003's title is "Loan hold"; the statement text embeds the title
  // but carries NO resolvedBy. In 0.29.0 this passed on the title hit;
  // in 0.30.0 skeleton:resolvedBy must fail it.
  const tree = resolvedByFixtureTree();
  const statements = [
    { id: 1, kind: 'capability', text: 'The system supports Loan hold handling.', addedAt: '2026-10-02T10:00:00Z', status: 'open' },
  ];
  const stage = checkD2Skeleton(resolvedByCtx(tree, statements));
  const check = stage.checks.find((c) => c.name === 'skeleton:resolvedBy');
  assert.ok(!check.ok, 'title hit must not pass in 0.30.0');
  assert.ok(check.failing.some((f) => f.id === 'brief:1'));
});

test('gates (REQ-173): a resolvedBy outside the grammar fails with "pointer does not resolve"', () => {
  const tree = resolvedByFixtureTree();
  const statements = [
    { id: 1, kind: 'capability', text: 'free text', resolvedBy: 'loan thing', addedAt: '2026-10-02T10:00:00Z', status: 'open' },
  ];
  const stage = checkD2Skeleton(resolvedByCtx(tree, statements));
  const check = stage.checks.find((c) => c.name === 'skeleton:resolvedBy');
  assert.ok(!check.ok);
  assert.ok(check.failing.some((f) => f.id === 'brief:1' && /pointer does not resolve/.test(f.why)));
});

// ---------------------------------------------------------------------------
// REQ-188 (US-18801): the [draft] marker extends to TAC.purpose and
// TAD.dataArchitecture.coreEntities[].description; shapes:draftSettled
// enumerates all three homes with three id forms.
// ---------------------------------------------------------------------------

test('gates (REQ-188): hasDraftMarker, parseTacPurposeDraft and parseCoreEntityDraft respect leading whitespace', () => {
  assert.equal(hasDraftMarker('[draft] a purpose'), true);
  assert.equal(hasDraftMarker('   [draft] a purpose'), true);
  assert.equal(hasDraftMarker('a bare one'), false);
  assert.equal(hasDraftMarker('[happy] not a draft marker'), false);
  assert.equal(hasDraftMarker(null), false);
  assert.equal(parseTacPurposeDraft({ purpose: '[draft] a purpose' }), true);
  assert.equal(parseTacPurposeDraft({ purpose: 'settled' }), false);
  assert.equal(parseTacPurposeDraft(null), false);
  assert.equal(parseCoreEntityDraft({ name: 'Note', description: '[draft] text from brief' }), true);
  assert.equal(parseCoreEntityDraft({ name: 'Note', description: 'owned' }), false);
  assert.equal(parseCoreEntityDraft(null), false);
});

test('gates (REQ-188, AC-18801-1): draft on coreEntity description fails draftSettled with TAD.entity:<name>', () => {
  const emptyLedgers = { brief: { statements: [] }, decisions: { decisions: [] }, concerns: { concerns: [] }, probes: { probes: [] } };
  const tree = makeTree({
    tad: { dataArchitecture: { coreEntities: [
      { name: 'LoanAccount', description: '[draft] loans on hold accrue no late fees.' },
      { name: 'Settled', description: 'an owned entity' },
    ] } },
  });
  const stage = checkD3Shapes({
    tree, ledgers: emptyLedgers, scope: new Set(),
    validateErrors: [], currentTreeHash: 'sha256:aaa',
  });
  const draft = stage.checks.find((c) => c.name === 'shapes:draftSettled');
  assert.ok(draft, 'draftSettled check must be emitted when a core entity carries the marker');
  assert.equal(draft.failing.length, 1);
  assert.equal(draft.failing[0].id, 'TAD.entity:LoanAccount');
  assert.match(draft.failing[0].why, /draft core entity/);
});

test('gates (REQ-188, AC-18801-2): draft on TAC.purpose fails draftSettled with <tacId>, tacHasInterface counts it present', () => {
  const emptyLedgers = { brief: { statements: [] }, decisions: { decisions: [] }, concerns: { concerns: [] }, probes: { probes: [] } };
  const tac = {
    tacId: 'TAC-D',
    purpose: '[draft] serve the loans-on-hold surface',
    interfaces: [{ name: 'ship', kind: 'httpRoute', description: 'settled' }],
  };
  const tree = makeTree({ tacs: [tac] });
  const stage = checkD3Shapes({
    tree, ledgers: emptyLedgers, scope: new Set(['TAC-D']),
    validateErrors: [], currentTreeHash: 'sha256:aaa',
  });
  const draft = stage.checks.find((c) => c.name === 'shapes:draftSettled');
  const iface = stage.checks.find((c) => c.name === 'shapes:tacHasInterface');
  assert.ok(iface.ok, 'tacHasInterface should still pass a TAC with an interface, draft purpose or not');
  assert.ok(draft.failing.some((f) => f.id === 'TAC-D'));
  assert.match(draft.failing.find((f) => f.id === 'TAC-D').why, /draft TAC purpose/);
});

test('gates (REQ-188, AC-18801-3): three draft homes cleared, draftSettled passes', () => {
  const emptyLedgers = { brief: { statements: [] }, decisions: { decisions: [] }, concerns: { concerns: [] }, probes: { probes: [] } };
  const tac = {
    tacId: 'TAC-S',
    purpose: 'serve the loans-on-hold surface',
    interfaces: [{ name: 'ship', kind: 'httpRoute', description: 'settled description' }],
  };
  const tree = makeTree({
    tacs: [tac],
    tad: { dataArchitecture: { coreEntities: [{ name: 'LoanAccount', description: 'owned entity' }] } },
  });
  const stage = checkD3Shapes({
    tree, ledgers: emptyLedgers, scope: new Set(['TAC-S']),
    validateErrors: [], currentTreeHash: 'sha256:aaa',
  });
  const draft = stage.checks.find((c) => c.name === 'shapes:draftSettled');
  assert.ok(draft.ok, 'draftSettled should pass when every marker is cleared');
  assert.equal(draft.failing.length, 0);
});

test('gates (REQ-188, AC-18801-4): draft recordShape without fields fails templateMarkers (lifted by PR 5 ADR-4131)', () => {
  // shapes:templateMarkers lands in DEFINE step 3 PR 5. A [draft]
  // recordShape without the `fields:` marker fails the same check as
  // a settled one; the draft prefix is stripped before the marker
  // scan so a drafted shape never passes just because the prefix
  // marker exists. The TC stays mapped to AC-18801-4 and completes
  // on this PR per spec section 9 "Drafts" row.
  const emptyLedgers = { brief: { statements: [] }, decisions: { decisions: [] }, concerns: { concerns: [] }, probes: { probes: [] } };
  const tac = {
    tacId: 'TAC-R',
    interfaces: [{ name: 'noteRecord', kind: 'recordShape', description: '[draft] a note record' }],
  };
  const tree = makeTree({ tacs: [tac] });
  const stage = checkD3Shapes({
    tree, ledgers: emptyLedgers, scope: new Set(['TAC-R']),
    validateErrors: [], currentTreeHash: 'sha256:aaa',
  });
  const templateMarkers = stage.checks.find((c) => c.name === 'shapes:templateMarkers');
  assert.ok(templateMarkers, 'shapes:templateMarkers must be emitted by D3 (ADR-4131)');
  assert.ok(templateMarkers.failing.some((f) => f.id === 'TAC-R:noteRecord' && /missing marker fields/.test(f.why)));
  // The draft marker itself is still reported.
  const draft = stage.checks.find((c) => c.name === 'shapes:draftSettled');
  assert.ok(draft.failing.some((f) => f.id === 'TAC-R:noteRecord'));
});

test('gates (REQ-188, AC-18801-5): draft-only tree keeps every productOwner check ok (L1-neutral)', () => {
  // A tree carrying only [draft] content across the three homes must
  // not fail any productOwner check. Build a tree whose only shape
  // material is drafts and whose other PO-owned stages are either
  // notApplicable or passing; assert that none of the stage checks
  // on it that CHECK_PERSONA maps to 'productOwner' fail.
  const emptyLedgers = { brief: { statements: [] }, decisions: { decisions: [] }, concerns: { concerns: [] }, probes: { probes: [] } };
  const tac = {
    tacId: 'TAC-DO',
    purpose: '[draft] draft purpose',
    interfaces: [{ name: 'uiHome', kind: 'uiRoute', description: '[draft] a draft route' }],
  };
  const tree = makeTree({
    tacs: [tac],
    tad: { dataArchitecture: { coreEntities: [{ name: 'DraftOnly', description: '[draft] draft entity' }] } },
  });
  const stage = checkD3Shapes({
    tree, ledgers: emptyLedgers, scope: new Set(['TAC-DO']),
    validateErrors: [], currentTreeHash: 'sha256:aaa',
  });
  // Only engineer checks may fail; no productOwner check reads draft content.
  for (const check of stage.checks) {
    if (check.ok) continue;
    assert.notEqual(
      check.persona, 'productOwner',
      `draft-only tree should not fail a productOwner check; ${check.name} failed`,
    );
  }
});

// ---------------------------------------------------------------------------
// ADR-4131 (US-17404, AC-17404-1..5): the three D3 bite checks and ackable.
// ---------------------------------------------------------------------------

import {
  ackable,
  parseInterfaceTemplate,
  extractInterfacePathTokens,
} from '../../src/query/gates.js';

test('gates (ADR-4131): parseInterfaceTemplate reports per-kind missing markers; drafts included', () => {
  // Happy: a recordShape with `fields:` has no missing markers.
  assert.deepEqual(parseInterfaceTemplate({ kind: 'recordShape', description: 'fields:\n  id: string' }), { kind: 'recordShape', missing: [] });
  // A draft prefix is stripped before the scan: a [draft] recordShape with `fields:` passes.
  assert.deepEqual(parseInterfaceTemplate({ kind: 'recordShape', description: '[draft] fields:\n  id: string' }), { kind: 'recordShape', missing: [] });
  // Failure: a [draft] recordShape with no `fields:` fails exactly as a settled one.
  const draftMiss = parseInterfaceTemplate({ kind: 'recordShape', description: '[draft] a note record' });
  assert.deepEqual(draftMiss, { kind: 'recordShape', missing: ['fields'] });
  // httpRoute requires all five markers.
  const good = parseInterfaceTemplate({ kind: 'httpRoute', description: 'method: POST\npath: /loans\nrequest: ...\nresponse: ...\nerrors: ...' });
  assert.deepEqual(good, { kind: 'httpRoute', missing: [] });
  const missErrors = parseInterfaceTemplate({ kind: 'httpRoute', description: 'method: POST\npath: /loans\nrequest: ...\nresponse: ...' });
  assert.deepEqual(missErrors, { kind: 'httpRoute', missing: ['errors'] });
  // Other needs a non-empty note.
  assert.deepEqual(parseInterfaceTemplate({ kind: 'other', description: '' }), { kind: 'other', missing: ['note'] });
  assert.deepEqual(parseInterfaceTemplate({ kind: 'other', description: '[draft]' }), { kind: 'other', missing: ['note'] });
  assert.deepEqual(parseInterfaceTemplate({ kind: 'other', description: 'A thing' }), { kind: 'other', missing: [] });
  // A kind outside the vocabulary leaves missing empty (kindVocabulary owns that).
  assert.deepEqual(parseInterfaceTemplate({ kind: 'bogus', description: 'anything' }), { kind: 'bogus', missing: [] });
});

test('gates (ADR-4131, AC-17404-1): recordShape+fields and httpRoute+5 markers each pass shapes:templateMarkers', () => {
  const emptyLedgers = { brief: { statements: [] }, decisions: { decisions: [] }, concerns: { concerns: [] }, probes: { probes: [] } };
  const tac = {
    tacId: 'TAC-HAPPY',
    interfaces: [
      { name: 'Loan', kind: 'recordShape', description: 'fields:\n  id: string\n  amount: number' },
      { name: 'ship', kind: 'httpRoute', description: 'method: POST\npath: /loans\nrequest: {}\nresponse: {}\nerrors: [422]' },
    ],
  };
  const tree = makeTree({ tacs: [tac] });
  const stage = checkD3Shapes({
    tree, ledgers: emptyLedgers, scope: new Set(['TAC-HAPPY']),
    validateErrors: [], currentTreeHash: 'sha256:aaa',
  });
  const templateMarkers = stage.checks.find((c) => c.name === 'shapes:templateMarkers');
  assert.ok(templateMarkers.ok, `expected pass, failing=${JSON.stringify(templateMarkers.failing)}`);
  assert.equal(templateMarkers.failing.length, 0);
  assert.equal(templateMarkers.total, 2);
});

test('gates (ADR-4131, AC-17404-2): httpRoute missing errors fails templateMarkers with <tacId>:<name> and "missing marker errors"', () => {
  const emptyLedgers = { brief: { statements: [] }, decisions: { decisions: [] }, concerns: { concerns: [] }, probes: { probes: [] } };
  const tac = {
    tacId: 'TAC-H',
    interfaces: [
      { name: 'noErrors', kind: 'httpRoute', description: 'method: POST\npath: /x\nrequest: {}\nresponse: {}' },
    ],
  };
  const tree = makeTree({ tacs: [tac] });
  const stage = checkD3Shapes({
    tree, ledgers: emptyLedgers, scope: new Set(['TAC-H']),
    validateErrors: [], currentTreeHash: 'sha256:aaa',
  });
  const templateMarkers = stage.checks.find((c) => c.name === 'shapes:templateMarkers');
  assert.ok(!templateMarkers.ok);
  const miss = templateMarkers.failing.find((f) => f.id === 'TAC-H:noErrors');
  assert.ok(miss, `expected failing TAC-H:noErrors, got ${JSON.stringify(templateMarkers.failing)}`);
  assert.equal(miss.why, 'missing marker errors');
});

test('gates (ADR-4131, AC-17404-3): entityJoin passes 1:1 and fails TAD.entity:<name> with "2 record shapes" when twice', () => {
  const emptyLedgers = { brief: { statements: [] }, decisions: { decisions: [] }, concerns: { concerns: [] }, probes: { probes: [] } };
  // Happy: one recordShape named Loan matching coreEntity Loan.
  const tacHappy = {
    tacId: 'TAC-J',
    interfaces: [
      { name: 'Loan', kind: 'recordShape', description: 'fields:\n  id: string' },
    ],
  };
  const treeHappy = makeTree({
    tacs: [tacHappy],
    tad: { dataArchitecture: { coreEntities: [{ name: 'Loan' }] } },
  });
  const stageHappy = checkD3Shapes({
    tree: treeHappy, ledgers: emptyLedgers, scope: new Set(['TAC-J']),
    validateErrors: [], currentTreeHash: 'sha256:aaa',
  });
  const joinHappy = stageHappy.checks.find((c) => c.name === 'shapes:entityJoin');
  assert.ok(joinHappy.ok, `expected pass, failing=${JSON.stringify(joinHappy.failing)}`);
  // Twice: two recordShapes name Loan -> fails "2 record shapes".
  const tacTwice = {
    tacId: 'TAC-K',
    interfaces: [
      { name: 'Loan', kind: 'recordShape', description: 'fields:\n  id: string' },
      { name: 'LoanV2', kind: 'recordShape', description: 'entity: Loan\nfields:\n  id: string' },
    ],
  };
  const treeTwice = makeTree({
    tacs: [tacTwice],
    tad: { dataArchitecture: { coreEntities: [{ name: 'Loan' }] } },
  });
  const stageTwice = checkD3Shapes({
    tree: treeTwice, ledgers: emptyLedgers, scope: new Set(['TAC-K']),
    validateErrors: [], currentTreeHash: 'sha256:aaa',
  });
  const joinTwice = stageTwice.checks.find((c) => c.name === 'shapes:entityJoin');
  assert.ok(!joinTwice.ok);
  const dup = joinTwice.failing.find((f) => f.id === 'TAD.entity:Loan');
  assert.ok(dup, `expected TAD.entity:Loan, got ${JSON.stringify(joinTwice.failing)}`);
  assert.equal(dup.why, '2 record shapes');
  // No record shape at all: fails "no record shape".
  const treeNone = makeTree({
    tacs: [{ tacId: 'TAC-N', interfaces: [{ name: 'ship', kind: 'httpRoute', description: 'method: POST\npath: /x\nrequest: {}\nresponse: {}\nerrors: []' }] }],
    tad: { dataArchitecture: { coreEntities: [{ name: 'Loan' }] } },
  });
  const stageNone = checkD3Shapes({
    tree: treeNone, ledgers: emptyLedgers, scope: new Set(['TAC-N']),
    validateErrors: [], currentTreeHash: 'sha256:aaa',
  });
  const joinNone = stageNone.checks.find((c) => c.name === 'shapes:entityJoin');
  assert.ok(!joinNone.ok);
  const missing = joinNone.failing.find((f) => f.id === 'TAD.entity:Loan');
  assert.ok(missing);
  assert.equal(missing.why, 'no record shape');
});

test('gates (ADR-4131, AC-17404-4): pathsResolve passes a resolved path and passes a missing path when authoredAt D3 is in the description', () => {
  const emptyLedgers = { brief: { statements: [] }, decisions: { decisions: [] }, concerns: { concerns: [] }, probes: { probes: [] } };
  const tac = {
    tacId: 'TAC-P',
    interfaces: [
      { name: 'resolved', kind: 'uiRoute', description: 'path: src/view/index.js' },
      { name: 'authored', kind: 'uiRoute', description: 'authoredAt: D3\npath: src/view/not-yet-landed.js' },
      { name: 'missing', kind: 'uiRoute', description: 'path: src/view/missing.js' },
    ],
  };
  const tree = makeTree({ tacs: [tac] });
  const resolvedPaths = new Set(['src/view/index.js']);
  const stage = checkD3Shapes({
    tree, ledgers: emptyLedgers, scope: new Set(['TAC-P']),
    validateErrors: [], currentTreeHash: 'sha256:aaa',
    resolvedPaths,
  });
  const paths = stage.checks.find((c) => c.name === 'shapes:pathsResolve');
  assert.ok(paths, 'shapes:pathsResolve must be emitted');
  // The one failing entry is the missing one; the resolved and authoredAt ones pass.
  assert.equal(paths.failing.length, 1);
  assert.equal(paths.failing[0].id, 'TAC-P:missing');
  assert.match(paths.failing[0].why, /path does not resolve: src\/view\/missing\.js/);
});

test('gates (ADR-4131): ackable(stage) is exactly D3, D5 and D6; stagePolicy keeps saying blocking', () => {
  assert.equal(ackable('D1'), false);
  assert.equal(ackable('D2'), false);
  assert.equal(ackable('D3'), true);
  assert.equal(ackable('D4'), false);
  assert.equal(ackable('D5'), true);
  assert.equal(ackable('D6'), true);
  assert.equal(ackable('D7'), false);
  assert.equal(ackable('D8'), false);
  // stagePolicy is unchanged (ADR-4122): blocking for every stage.
  for (const stage of ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8']) {
    const policy = stagePolicy(stage);
    assert.ok(policy === 'blocking' || policy === 'warnWithAck', `${stage}: ${policy}`);
  }
});

test('gates (ADR-4131): D3 notApplicable (no TAC, no shaped REQ, no draft entity) keeps the three bite checks out of the envelope', () => {
  const emptyLedgers = { brief: { statements: [] }, decisions: { decisions: [] }, concerns: { concerns: [] }, probes: { probes: [] } };
  const stage = checkD3Shapes({
    tree: makeTree(), ledgers: emptyLedgers, scope: new Set(),
    validateErrors: [], currentTreeHash: 'sha256:aaa',
  });
  assert.equal(stage.state, 'notApplicable');
  // The envelope carries only the stage:D3:scope placeholder; the
  // three bite checks are not emitted because the stage short-circuits
  // on an empty scope.
  const names = stage.checks.map((c) => c.name);
  assert.ok(!names.includes('shapes:templateMarkers'));
  assert.ok(!names.includes('shapes:entityJoin'));
  assert.ok(!names.includes('shapes:pathsResolve'));
});

test('gates (ADR-4131): extractInterfacePathTokens picks path: tokens and skips URLs, globs and placeholders', () => {
  assert.deepEqual(extractInterfacePathTokens('path: src/view/index.js'), ['src/view/index.js']);
  assert.deepEqual(extractInterfacePathTokens('a line\npath: src/view/index.js\npath: packages/x.json'), ['src/view/index.js', 'packages/x.json']);
  assert.deepEqual(extractInterfacePathTokens('path: https://example.com/x'), []);
  assert.deepEqual(extractInterfacePathTokens('path: {placeholder}'), []);
  assert.deepEqual(extractInterfacePathTokens('path: src/**/*.js'), []);
  assert.deepEqual(extractInterfacePathTokens('path: justAWord'), []);
});

// ---------------------------------------------------------------------------
// PR 6 (US-17405, AC-17405-1..6): D4 closed-set and ownerRef findings;
// D5 crosscut:catalogue; D2 skeleton:standardsCited.
// ---------------------------------------------------------------------------

test('gates (PR 6, AC-17405-1): closedSets fails an AC with an enumeration cue and no bracketed list or ownerRef', () => {
  const emptyLedgers = { brief: { statements: [] }, decisions: { decisions: [] }, concerns: { concerns: [] }, probes: { probes: [] } };
  const req = { reqId: 'REQ-1', shapeClassification: { shapes: ['httpApi'] } };
  const us = {
    usId: 'US-1',
    reqId: 'REQ-1',
    tacIds: ['TAC-1'],
    acceptanceCriteria: [
      { id: 'AC-1', testable: true, description: '[happy] user does the thing' },
      { id: 'AC-2', testable: true, description: '[failure] status is one of the following' },
      { id: 'AC-3', testable: true, description: '[edge] status is one of [open, closed]' },
    ],
  };
  const tac = { tacId: 'TAC-1', interfaces: [{ name: 'x', kind: 'other', description: 'note' }] };
  const stage = checkD4Stories({
    tree: makeTree({ requirements: [req], userStories: [us], tacs: [tac] }),
    ledgers: emptyLedgers,
    scope: new Set(['REQ-1', 'US-1']),
  });
  const closed = stage.checks.find((c) => c.name === 'stories:closedSets');
  assert.ok(closed);
  assert.equal(closed.ok, false);
  const failing = closed.failing.find((f) => f.id === 'AC-2');
  assert.ok(failing, `AC-2 should fail closedSets; got ${JSON.stringify(closed.failing)}`);
  assert.match(failing.why, /enumeration cue without a closed set/);
  // AC-3 has an inline bracketed list, so it does not fail.
  assert.equal(closed.failing.some((f) => f.id === 'AC-3'), false);
});

test('gates (PR 6, AC-17405-1): closedSets honours the quoted-cue guard shared with D6', () => {
  const emptyLedgers = { brief: { statements: [] }, decisions: { decisions: [] }, concerns: { concerns: [] }, probes: { probes: [] } };
  const us = {
    usId: 'US-1',
    reqId: 'REQ-1',
    tacIds: ['TAC-1'],
    acceptanceCriteria: [
      { id: 'AC-Q', testable: true, description: '[happy] the user types "status is" into the search box and nothing explodes' },
    ],
  };
  const req = { reqId: 'REQ-1', shapeClassification: { shapes: ['httpApi'] } };
  const tac = { tacId: 'TAC-1', interfaces: [{ name: 'x', kind: 'other', description: 'note' }] };
  const stage = checkD4Stories({
    tree: makeTree({ requirements: [req], userStories: [us], tacs: [tac] }),
    ledgers: emptyLedgers,
    scope: new Set(['REQ-1', 'US-1']),
  });
  const closed = stage.checks.find((c) => c.name === 'stories:closedSets');
  assert.ok(closed);
  assert.equal(closed.ok, true, `quoted cue should not fire; got ${JSON.stringify(closed.failing)}`);
});

test('gates (PR 6, AC-17405-2): ownerRefResolves passes a resolving pointer and fails a missing one', () => {
  const emptyLedgers = { brief: { statements: [] }, decisions: { decisions: [] }, concerns: { concerns: [] }, probes: { probes: [] } };
  const tac = {
    tacId: 'TAC-1',
    interfaces: [
      { name: 'loan', kind: 'recordShape', description: 'fields: id, amount' },
    ],
  };
  const us = {
    usId: 'US-1',
    reqId: 'REQ-1',
    tacIds: ['TAC-1'],
    acceptanceCriteria: [
      { id: 'AC-OK', testable: true, description: '[happy] the loan is created', ownerRef: { tacId: 'TAC-1', field: 'interfaces[loan]' } },
      { id: 'AC-FAIL', testable: true, description: '[happy] the loan is created', ownerRef: { tacId: 'TAC-1', field: 'interfaces[missing]' } },
    ],
  };
  const req = { reqId: 'REQ-1', shapeClassification: { shapes: ['persistence'] } };
  const stage = checkD4Stories({
    tree: makeTree({ requirements: [req], userStories: [us], tacs: [tac] }),
    ledgers: emptyLedgers,
    scope: new Set(['REQ-1', 'US-1']),
  });
  const check = stage.checks.find((c) => c.name === 'stories:ownerRefResolves');
  assert.ok(check);
  assert.equal(check.failing.length, 1, `got ${JSON.stringify(check.failing)}`);
  assert.equal(check.failing[0].id, 'AC-FAIL:interfaces[missing]');
  assert.equal(check.failing[0].why, 'ownerRef does not resolve');
});

test('gates (PR 6, AC-17405-3): crosscut:catalogue passes a persistence REQ with retention applied and timeAndTimezone waived', () => {
  const req = {
    reqId: 'REQ-1',
    shapeClassification: { shapes: ['persistence'] },
  };
  const ledgers = {
    brief: { statements: [] },
    decisions: { decisions: [] },
    concerns: {
      concerns: [
        { id: 1, reqId: 'REQ-1', concern: 'loggingAudit', disposition: 'applied', status: 'resolved', addedAt: '2026-10-03T10:00:00Z', resolvedAt: '2026-10-03T10:00:00Z' },
        { id: 2, reqId: 'REQ-1', concern: 'retention', disposition: 'applied', status: 'resolved', addedAt: '2026-10-03T10:00:00Z', resolvedAt: '2026-10-03T10:00:00Z' },
        { id: 3, reqId: 'REQ-1', concern: 'timeAndTimezone', disposition: 'waived', reason: 'single-timezone deployment', status: 'resolved', addedAt: '2026-10-03T10:00:00Z', resolvedAt: '2026-10-03T10:00:00Z' },
        { id: 4, reqId: 'REQ-1', concern: 'concurrencyIdempotency', disposition: 'applied', status: 'resolved', addedAt: '2026-10-03T10:00:00Z', resolvedAt: '2026-10-03T10:00:00Z' },
      ],
    },
    probes: { probes: [] },
  };
  const stage = checkD5Crosscut({
    tree: makeTree({ requirements: [req] }),
    ledgers,
    scope: new Set(['REQ-1']),
    currentTreeHash: 'sha256:aaa',
  });
  const check = stage.checks.find((c) => c.name === 'crosscut:catalogue');
  assert.ok(check);
  assert.equal(check.ok, true, `catalogue should pass; failing=${JSON.stringify(check.failing)}`);
  // persistence's applicable concerns are loggingAudit, retention,
  // timeAndTimezone, concurrencyIdempotency: four pairs.
  assert.equal(check.total, 4);
  assert.equal(check.pass, 4);
});

test('gates (PR 6, AC-17405-3): crosscut:catalogue fails a waived entry without a reason', () => {
  const req = { reqId: 'REQ-1', shapeClassification: { shapes: ['persistence'] } };
  const ledgers = {
    brief: { statements: [] },
    decisions: { decisions: [] },
    concerns: {
      concerns: [
        { id: 1, reqId: 'REQ-1', concern: 'loggingAudit', disposition: 'applied', status: 'resolved', addedAt: '2026-10-03T10:00:00Z', resolvedAt: '2026-10-03T10:00:00Z' },
        { id: 2, reqId: 'REQ-1', concern: 'retention', disposition: 'applied', status: 'resolved', addedAt: '2026-10-03T10:00:00Z', resolvedAt: '2026-10-03T10:00:00Z' },
        { id: 3, reqId: 'REQ-1', concern: 'timeAndTimezone', disposition: 'waived', reason: '', status: 'resolved', addedAt: '2026-10-03T10:00:00Z', resolvedAt: '2026-10-03T10:00:00Z' },
        { id: 4, reqId: 'REQ-1', concern: 'concurrencyIdempotency', disposition: 'applied', status: 'resolved', addedAt: '2026-10-03T10:00:00Z', resolvedAt: '2026-10-03T10:00:00Z' },
      ],
    },
    probes: { probes: [] },
  };
  const stage = checkD5Crosscut({
    tree: makeTree({ requirements: [req] }),
    ledgers,
    scope: new Set(['REQ-1']),
    currentTreeHash: 'sha256:aaa',
  });
  const check = stage.checks.find((c) => c.name === 'crosscut:catalogue');
  assert.ok(check);
  const waivedMiss = check.failing.find((f) => f.id === 'REQ-1:timeAndTimezone');
  assert.ok(waivedMiss, `expected REQ-1:timeAndTimezone to fail; got ${JSON.stringify(check.failing)}`);
  assert.match(waivedMiss.why, /waived without a reason/);
});

test('gates (PR 6, AC-17405-4): crosscut:catalogue fails <REQ>:errorEnvelope when the httpApi REQ has no concern-ledger entry', () => {
  const req = { reqId: 'REQ-7', shapeClassification: { shapes: ['httpApi'] } };
  // Supply every other applicable concern so the only failure is errorEnvelope.
  const ledgers = {
    brief: { statements: [] },
    decisions: { decisions: [] },
    concerns: {
      concerns: [
        { id: 1, reqId: 'REQ-7', concern: 'auth', disposition: 'applied', status: 'resolved', addedAt: '2026-10-03T10:00:00Z', resolvedAt: '2026-10-03T10:00:00Z' },
        { id: 2, reqId: 'REQ-7', concern: 'loggingAudit', disposition: 'applied', status: 'resolved', addedAt: '2026-10-03T10:00:00Z', resolvedAt: '2026-10-03T10:00:00Z' },
        { id: 3, reqId: 'REQ-7', concern: 'performance', disposition: 'applied', status: 'resolved', addedAt: '2026-10-03T10:00:00Z', resolvedAt: '2026-10-03T10:00:00Z' },
        { id: 4, reqId: 'REQ-7', concern: 'concurrencyIdempotency', disposition: 'applied', status: 'resolved', addedAt: '2026-10-03T10:00:00Z', resolvedAt: '2026-10-03T10:00:00Z' },
      ],
    },
    probes: { probes: [] },
  };
  const stage = checkD5Crosscut({
    tree: makeTree({ requirements: [req] }),
    ledgers,
    scope: new Set(['REQ-7']),
    currentTreeHash: 'sha256:aaa',
  });
  const check = stage.checks.find((c) => c.name === 'crosscut:catalogue');
  assert.ok(check);
  assert.equal(check.failing.length, 1);
  assert.equal(check.failing[0].id, 'REQ-7:errorEnvelope');
  assert.match(check.failing[0].why, /missing concern-ledger entry for errorEnvelope/);
});

test('gates (PR 6, AC-17405-5): standardsCited passes when cited or waived; fails when neither', () => {
  const emptyLedgers = { brief: { statements: [] }, decisions: { decisions: [] }, concerns: { concerns: [] }, probes: { probes: [] } };
  // One pack cited in a REQ rationale, one in an ADR, one uncited.
  const manifest = { standards: [
    { slug: 'company-ui', provenance: 'corporate' },
    { slug: 'company-security', provenance: 'corporate' },
    { slug: 'personal-styles', provenance: 'personal' },
  ] };
  const req = { reqId: 'REQ-1', description: 'ok', domain: 'ops', shapeClassification: { shapes: ['other'] }, rationale: 'follows company-ui standards' };
  const adr = { adrId: 'ADR-1', title: 'Deploy target: Hetzner', decision: 'use company-security policy baseline' };
  const tree = makeTree({ manifest, requirements: [req], adrs: [adr] });
  const stage = checkD2Skeleton({
    tree,
    ledgers: emptyLedgers,
    scope: new Set(['REQ-1']),
    currentTreeHash: 'sha256:aaa',
  });
  const check = stage.checks.find((c) => c.name === 'skeleton:standardsCited');
  assert.ok(check);
  assert.equal(check.failing.length, 1, `only personal-styles should fail; got ${JSON.stringify(check.failing)}`);
  assert.equal(check.failing[0].id, 'standards:personal-styles');
  assert.equal(check.failing[0].why, 'uncited and unwaived');

  // Add a waiver on the concern ledger -> passes.
  const ledgersWithWaiver = {
    brief: { statements: [] },
    decisions: { decisions: [] },
    concerns: { concerns: [
      { id: 1, reqId: 'REQ-1', concern: 'standards:personal-styles', disposition: 'waived', reason: 'personal pack is advisory only', status: 'resolved', addedAt: '2026-10-03T10:00:00Z', resolvedAt: '2026-10-03T10:00:00Z' },
    ] },
    probes: { probes: [] },
  };
  const stage2 = checkD2Skeleton({
    tree,
    ledgers: ledgersWithWaiver,
    scope: new Set(['REQ-1']),
    currentTreeHash: 'sha256:aaa',
  });
  const check2 = stage2.checks.find((c) => c.name === 'skeleton:standardsCited');
  assert.ok(check2);
  assert.equal(check2.ok, true, `with the waiver, every pack should pass; failing=${JSON.stringify(check2.failing)}`);
});

test('gates (PR 6, AC-17405-5): standardsCited notApplicable envelope: zero registered packs returns a 0/1 passing check', () => {
  const emptyLedgers = { brief: { statements: [] }, decisions: { decisions: [] }, concerns: { concerns: [] }, probes: { probes: [] } };
  const manifest = { standards: [] };
  const req = { reqId: 'REQ-1', description: 'ok', domain: 'ops', shapeClassification: { shapes: ['other'] } };
  const stage = checkD2Skeleton({
    tree: makeTree({ manifest, requirements: [req] }),
    ledgers: emptyLedgers,
    scope: new Set(['REQ-1']),
    currentTreeHash: 'sha256:aaa',
  });
  const check = stage.checks.find((c) => c.name === 'skeleton:standardsCited');
  assert.ok(check);
  assert.equal(check.ok, true);
  assert.equal(check.failing.length, 0);
});

test('gates (PR 6): new D4/D5 checks respect the section 2.4 shape (persona, question, ok, over, pass, total, failing)', () => {
  const emptyLedgers = { brief: { statements: [] }, decisions: { decisions: [] }, concerns: { concerns: [] }, probes: { probes: [] } };
  const req = { reqId: 'REQ-1', shapeClassification: { shapes: ['httpApi'] } };
  const us = {
    usId: 'US-1',
    reqId: 'REQ-1',
    tacIds: ['TAC-1'],
    acceptanceCriteria: [{ id: 'AC-1', testable: true, description: '[happy] user does the thing' }],
  };
  const tac = { tacId: 'TAC-1', interfaces: [{ name: 'x', kind: 'other', description: 'note' }] };
  const d4 = checkD4Stories({
    tree: makeTree({ requirements: [req], userStories: [us], tacs: [tac] }),
    ledgers: emptyLedgers,
    scope: new Set(['REQ-1', 'US-1']),
  });
  assertCheckShape(d4);
  for (const name of ['stories:closedSets', 'stories:ownerRefResolves']) {
    const c = d4.checks.find((c) => c.name === name);
    assert.ok(c, `${name} must be emitted`);
    assert.equal(c.persona, 'engineer');
    assert.ok(c.question && c.question.length > 0);
  }
  const d5 = checkD5Crosscut({
    tree: makeTree({ requirements: [req] }),
    ledgers: emptyLedgers,
    scope: new Set(['REQ-1']),
  });
  assertCheckShape(d5);
  const catalogue = d5.checks.find((c) => c.name === 'crosscut:catalogue');
  assert.ok(catalogue);
  assert.equal(catalogue.persona, 'engineer');
  assert.equal(catalogue.over, 'tree');
});
