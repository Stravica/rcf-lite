// Unit tests for the pure `computeCoverage` function. Uses small
// hand-built TreeModel-shaped fixtures so each rule is exercised in
// isolation (spec §D2, §4.1).
//
// w-2026-07-28-005: "covered" is resolution-gated. Fixtures supply a
// `testPointers` resolution map (the shape core's `resolveTestPointers`
// returns); a TC missing from the map, or present with resolved:false,
// never counts as coverage - it surfaces as covered-unresolved.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { testCaseKey } from '@stravica-ai/rcf-lite-core/store';
import { classifyCoverageScope, computeCoverage } from '../../src/query/coverage.js';

/**
 * Build a minimal TreeModel-like object. Only fields consumed by
 * `computeCoverage` need to be populated.
 */
function makeTree({ requirements = [], userStories = [], tcsByAcId = new Map() } = {}) {
  const kindById = new Map();
  const byId = new Map();
  const childrenByParent = new Map();
  for (const r of requirements) {
    kindById.set(r.reqId, 'req');
    byId.set(r.reqId, r);
  }
  for (const us of userStories) {
    kindById.set(us.usId, 'userStory');
    byId.set(us.usId, us);
    const list = childrenByParent.get(us.reqId) ?? [];
    list.push(us.usId);
    childrenByParent.set(us.reqId, list);
  }
  return {
    requirements,
    userStories,
    kindById,
    byId,
    childrenByParent,
    tcsByAcId,
  };
}

/** Resolution-map helper: mark the given (tsId, tcId) pairs as resolving. */
function resolvedMap(...pairs) {
  const map = new Map();
  for (const [tsId, tcId] of pairs) {
    map.set(testCaseKey(tsId, tcId), {
      resolved: true, reason: 'ok', testPointer: `test/x.test.js::${tcId}`, tsId, tcId,
    });
  }
  return map;
}

/** Resolution-map helper: an explicit unresolved entry. */
function unresolvedEntry(map, tsId, tcId, reason, testPointer = null) {
  map.set(testCaseKey(tsId, tcId), { resolved: false, reason, testPointer, tsId, tcId });
  return map;
}

test('shallow-any default: REQ with one AC covered by one RESOLVING TC returns covered', () => {
  const tree = makeTree({
    requirements: [{ reqId: 'REQ-001', prdId: 'PRD-001' }],
    userStories: [{
      usId: 'US-101',
      reqId: 'REQ-001',
      acceptanceCriteria: [{ id: 'AC-101-1' }],
    }],
    tcsByAcId: new Map([['AC-101-1', [{ tsId: 'TS-001', tcId: 'TC-001-happy' }]]]),
  });
  const r = computeCoverage(tree, { testPointers: resolvedMap(['TS-001', 'TC-001-happy']) });
  assert.equal(r.ok, true);
  assert.equal(r.totals.covered, 1);
  assert.equal(r.totals.coveredUnresolved, 0);
  assert.equal(r.totals.uncovered, 0);
  assert.equal(r.requirements[0].covered, true);
  assert.equal(r.requirements[0].coverageClass, 'covered');
  assert.deepEqual(r.requirements[0].acs[0].testCases, ['TC-001-happy']);
  assert.deepEqual(r.requirements[0].acs[0].unresolvedTestCases, []);
  assert.deepEqual(r.unresolvedTestPointers, []);
});

test('a TC row whose pointer does NOT resolve is covered-unresolved, never covered (the stub-TC trap)', () => {
  const tree = makeTree({
    requirements: [{ reqId: 'REQ-001', prdId: 'PRD-001' }],
    userStories: [{
      usId: 'US-101',
      reqId: 'REQ-001',
      acceptanceCriteria: [{ id: 'AC-101-1' }],
    }],
    tcsByAcId: new Map([['AC-101-1', [{ tsId: 'TS-001', tcId: 'TC-001-stub' }]]]),
  });
  const testPointers = unresolvedEntry(new Map(), 'TS-001', 'TC-001-stub', 'file-missing', 'test/gone.test.js::stub');
  const r = computeCoverage(tree, { testPointers });
  assert.equal(r.ok, false, 'a stub TC must not produce ok:true');
  assert.equal(r.totals.covered, 0);
  assert.equal(r.totals.coveredUnresolved, 1);
  assert.equal(r.totals.uncovered, 0);
  assert.equal(r.requirements[0].covered, false);
  assert.equal(r.requirements[0].coverageClass, 'covered-unresolved');
  assert.deepEqual(r.requirements[0].acs[0].unresolvedTestCases, ['TC-001-stub']);
  assert.deepEqual(r.unresolvedTestPointers, [{
    tsId: 'TS-001', tcId: 'TC-001-stub', testPointer: 'test/gone.test.js::stub', reason: 'file-missing',
  }]);
});

test('no resolution map at all fails closed: every TC is unresolved', () => {
  const tree = makeTree({
    requirements: [{ reqId: 'REQ-001', prdId: 'PRD-001' }],
    userStories: [{
      usId: 'US-101',
      reqId: 'REQ-001',
      acceptanceCriteria: [{ id: 'AC-101-1' }],
    }],
    tcsByAcId: new Map([['AC-101-1', [{ tsId: 'TS-001', tcId: 'TC-001-happy' }]]]),
  });
  const r = computeCoverage(tree);
  assert.equal(r.ok, false);
  assert.equal(r.totals.coveredUnresolved, 1);
  assert.equal(r.requirements[0].coverageClass, 'covered-unresolved');
  assert.equal(r.unresolvedTestPointers[0].reason, 'missing-pointer');
});

test('mixed AC: one resolving TC + one unresolved TC = covered, with the unresolved one still listed', () => {
  const tree = makeTree({
    requirements: [{ reqId: 'REQ-001', prdId: 'PRD-001' }],
    userStories: [{
      usId: 'US-101',
      reqId: 'REQ-001',
      acceptanceCriteria: [{ id: 'AC-101-1' }],
    }],
    tcsByAcId: new Map([['AC-101-1', [
      { tsId: 'TS-001', tcId: 'TC-001-real' },
      { tsId: 'TS-001', tcId: 'TC-001-stub' },
    ]]]),
  });
  const testPointers = resolvedMap(['TS-001', 'TC-001-real']);
  unresolvedEntry(testPointers, 'TS-001', 'TC-001-stub', 'test-missing', 'test/x.test.js::renamed');
  const r = computeCoverage(tree, { testPointers });
  assert.equal(r.requirements[0].covered, true);
  assert.equal(r.requirements[0].coverageClass, 'covered');
  assert.deepEqual(r.requirements[0].acs[0].unresolvedTestCases, ['TC-001-stub']);
  assert.equal(r.unresolvedTestPointers.length, 1, 'unresolved pointer stays visible even on a covered AC');
  // ok reflects requirement coverage, not pointer hygiene on already-covered ACs.
  assert.equal(r.ok, true);
});

test('strict per-AC: REQ with one AC covered, one uncovered - covered:false under strict, true under shallow', () => {
  const tree = makeTree({
    requirements: [{ reqId: 'REQ-001', prdId: 'PRD-001' }],
    userStories: [{
      usId: 'US-101',
      reqId: 'REQ-001',
      acceptanceCriteria: [{ id: 'AC-101-1' }, { id: 'AC-101-2' }],
    }],
    tcsByAcId: new Map([['AC-101-1', [{ tsId: 'TS-001', tcId: 'TC-001-a' }]]]),
  });
  const testPointers = resolvedMap(['TS-001', 'TC-001-a']);
  const shallow = computeCoverage(tree, { testPointers });
  const strict = computeCoverage(tree, { strict: true, testPointers });
  assert.equal(shallow.requirements[0].covered, true);
  assert.equal(strict.requirements[0].covered, false);
  assert.equal(strict.requirements[0].coverageClass, 'uncovered');
  assert.equal(strict.ok, false);
});

test('strict per-AC: a resolving TC on one AC and a stub on the other = covered-unresolved under strict', () => {
  const tree = makeTree({
    requirements: [{ reqId: 'REQ-001', prdId: 'PRD-001' }],
    userStories: [{
      usId: 'US-101',
      reqId: 'REQ-001',
      acceptanceCriteria: [{ id: 'AC-101-1' }, { id: 'AC-101-2' }],
    }],
    tcsByAcId: new Map([
      ['AC-101-1', [{ tsId: 'TS-001', tcId: 'TC-001-a' }]],
      ['AC-101-2', [{ tsId: 'TS-001', tcId: 'TC-001-b' }]],
    ]),
  });
  const testPointers = resolvedMap(['TS-001', 'TC-001-a']);
  unresolvedEntry(testPointers, 'TS-001', 'TC-001-b', 'file-missing', 'test/none.test.js::b');
  const strict = computeCoverage(tree, { strict: true, testPointers });
  assert.equal(strict.requirements[0].coverageClass, 'covered-unresolved');
  assert.equal(strict.totals.coveredUnresolved, 1);
  assert.equal(strict.ok, false);
});

test('REQ with zero US returns uncovered', () => {
  const tree = makeTree({
    requirements: [{ reqId: 'REQ-001', prdId: 'PRD-001' }],
    userStories: [],
  });
  const r = computeCoverage(tree);
  assert.equal(r.requirements[0].covered, false);
  assert.equal(r.requirements[0].coverageClass, 'uncovered');
  assert.equal(r.requirements[0].acs.length, 0);
});

test('US with zero AC returns REQ uncovered', () => {
  const tree = makeTree({
    requirements: [{ reqId: 'REQ-001', prdId: 'PRD-001' }],
    userStories: [{ usId: 'US-101', reqId: 'REQ-001', acceptanceCriteria: [] }],
  });
  const r = computeCoverage(tree);
  assert.equal(r.requirements[0].covered, false);
  assert.equal(r.requirements[0].coverageClass, 'uncovered');
});

test('AC with no TC cross-link at all is absent (uncovered), not unresolved', () => {
  const tree = makeTree({
    requirements: [{ reqId: 'REQ-001', prdId: 'PRD-001' }],
    userStories: [{
      usId: 'US-101',
      reqId: 'REQ-001',
      acceptanceCriteria: [{ id: 'AC-101-1' }],
    }],
    tcsByAcId: new Map(),
  });
  const r = computeCoverage(tree);
  assert.equal(r.requirements[0].covered, false);
  assert.equal(r.requirements[0].coverageClass, 'uncovered');
  assert.equal(r.totals.coveredUnresolved, 0);
  assert.equal(r.totals.uncovered, 1);
  assert.deepEqual(r.requirements[0].acs[0].testCases, []);
  assert.deepEqual(r.unresolvedTestPointers, []);
});

test('multi-REQ tree: covered / covered-unresolved / uncovered totals all distinct', () => {
  const tree = makeTree({
    requirements: [
      { reqId: 'REQ-001', prdId: 'PRD-001' },
      { reqId: 'REQ-002', prdId: 'PRD-001' },
      { reqId: 'REQ-003', prdId: 'PRD-001' },
    ],
    userStories: [
      { usId: 'US-101', reqId: 'REQ-001', acceptanceCriteria: [{ id: 'AC-101-1' }] },
      { usId: 'US-201', reqId: 'REQ-002', acceptanceCriteria: [{ id: 'AC-201-1' }] },
      { usId: 'US-301', reqId: 'REQ-003', acceptanceCriteria: [{ id: 'AC-301-1' }] },
    ],
    tcsByAcId: new Map([
      ['AC-101-1', [{ tsId: 'TS-001', tcId: 'TC-001-a' }]],
      ['AC-201-1', [{ tsId: 'TS-002', tcId: 'TC-002-a' }]],
    ]),
  });
  const testPointers = resolvedMap(['TS-001', 'TC-001-a']);
  unresolvedEntry(testPointers, 'TS-002', 'TC-002-a', 'test-missing', 'test/y.test.js::a');
  const r = computeCoverage(tree, { testPointers });
  assert.equal(r.totals.requirements, 3);
  assert.equal(r.totals.covered, 1);
  assert.equal(r.totals.coveredUnresolved, 1);
  assert.equal(r.totals.uncovered, 1);
  assert.equal(r.ok, false);
});

test('withCode: implemented-and-covered requires a RESOLVING TC; a stub TC yields implemented-uncovered', () => {
  const tree = makeTree({
    requirements: [{ reqId: 'REQ-001', prdId: 'PRD-001' }],
    userStories: [{
      usId: 'US-101',
      reqId: 'REQ-001',
      acceptanceCriteria: [{ id: 'AC-101-1' }, { id: 'AC-101-2' }],
    }],
    tcsByAcId: new Map([
      ['AC-101-1', [{ tsId: 'TS-001', tcId: 'TC-001-real' }]],
      ['AC-101-2', [{ tsId: 'TS-001', tcId: 'TC-001-stub' }]],
    ]),
  });
  tree.cnByAcId = new Map([
    ['AC-101-1', ['CN-001']],
    ['AC-101-2', ['CN-002']],
  ]);
  tree.codeNodes = [];
  const testPointers = resolvedMap(['TS-001', 'TC-001-real']);
  unresolvedEntry(testPointers, 'TS-001', 'TC-001-stub', 'file-missing', 'test/none.test.js::stub');
  const r = computeCoverage(tree, { withCode: true, testPointers });
  const [ac1, ac2] = r.requirements[0].acs;
  assert.equal(ac1.codeClass, 'implemented-and-covered');
  assert.equal(ac2.codeClass, 'implemented-uncovered', 'stub TC must not manufacture implemented-and-covered');
  assert.equal(r.codeTotals.implementedAndCovered, 1);
  assert.equal(r.codeTotals.implementedUncovered, 1);
});

test('scoped to PRD returns only that PRDs requirements', () => {
  const tree = makeTree({
    requirements: [
      { reqId: 'REQ-001', prdId: 'PRD-A' },
      { reqId: 'REQ-002', prdId: 'PRD-B' },
    ],
  });
  tree.kindById.set('PRD-A', 'prd');
  tree.kindById.set('PRD-B', 'prd');
  const r = computeCoverage(tree, { scopeId: 'PRD-A' });
  assert.equal(r.totals.requirements, 1);
  assert.equal(r.requirements[0].id, 'REQ-001');
});

test('scoped to REQ returns just that REQ', () => {
  const tree = makeTree({
    requirements: [
      { reqId: 'REQ-001', prdId: 'PRD-001' },
      { reqId: 'REQ-002', prdId: 'PRD-001' },
    ],
  });
  const r = computeCoverage(tree, { scopeId: 'REQ-002' });
  assert.equal(r.totals.requirements, 1);
  assert.equal(r.requirements[0].id, 'REQ-002');
});

test('scoped to US finds the owning REQ', () => {
  const tree = makeTree({
    requirements: [
      { reqId: 'REQ-001', prdId: 'PRD-001' },
      { reqId: 'REQ-002', prdId: 'PRD-001' },
    ],
    userStories: [
      { usId: 'US-201', reqId: 'REQ-002', acceptanceCriteria: [] },
    ],
  });
  const r = computeCoverage(tree, { scopeId: 'US-201' });
  assert.equal(r.totals.requirements, 1);
  assert.equal(r.requirements[0].id, 'REQ-002');
});

test('classifyCoverageScope distinguishes valid / below-ac / not-found', () => {
  const tree = makeTree({
    requirements: [{ reqId: 'REQ-001', prdId: 'PRD-001' }],
  });
  tree.kindById.set('PRD-001', 'prd');
  tree.kindById.set('TAC-001', 'tac');
  assert.equal(classifyCoverageScope(tree, 'PRD-001'), 'valid');
  assert.equal(classifyCoverageScope(tree, 'REQ-001'), 'valid');
  assert.equal(classifyCoverageScope(tree, 'TAC-001'), 'below-ac');
  assert.equal(classifyCoverageScope(tree, 'AC-101-1'), 'below-ac');
  assert.equal(classifyCoverageScope(tree, 'TC-001-x'), 'below-ac');
  assert.equal(classifyCoverageScope(tree, 'DOES-NOT-EXIST'), 'not-found');
});
