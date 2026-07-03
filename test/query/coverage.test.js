// Unit tests for the pure `computeCoverage` function. Uses small
// hand-built TreeModel-shaped fixtures so each rule is exercised in
// isolation (spec §D2, §4.1).

import { test } from 'node:test';
import assert from 'node:assert/strict';

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

test('shallow-any default: REQ with one AC covered by one TC returns covered', () => {
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
  assert.equal(r.ok, true);
  assert.equal(r.totals.covered, 1);
  assert.equal(r.totals.uncovered, 0);
  assert.equal(r.requirements[0].covered, true);
  assert.deepEqual(r.requirements[0].acs[0].testCases, ['TC-001-happy']);
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
  const shallow = computeCoverage(tree);
  const strict = computeCoverage(tree, { strict: true });
  assert.equal(shallow.requirements[0].covered, true);
  assert.equal(strict.requirements[0].covered, false);
  assert.equal(strict.ok, false);
});

test('REQ with zero US returns covered:false', () => {
  const tree = makeTree({
    requirements: [{ reqId: 'REQ-001', prdId: 'PRD-001' }],
    userStories: [],
  });
  const r = computeCoverage(tree);
  assert.equal(r.requirements[0].covered, false);
  assert.equal(r.requirements[0].acs.length, 0);
});

test('US with zero AC returns REQ covered:false', () => {
  const tree = makeTree({
    requirements: [{ reqId: 'REQ-001', prdId: 'PRD-001' }],
    userStories: [{ usId: 'US-101', reqId: 'REQ-001', acceptanceCriteria: [] }],
  });
  const r = computeCoverage(tree);
  assert.equal(r.requirements[0].covered, false);
});

test('AC with no TC cross-link returns covered:false', () => {
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
  assert.equal(r.requirements[0].acs[0].covered, false);
  assert.deepEqual(r.requirements[0].acs[0].testCases, []);
});

test('multi-REQ tree: mixed coverage totals correct', () => {
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
  const r = computeCoverage(tree);
  assert.equal(r.totals.requirements, 3);
  assert.equal(r.totals.covered, 2);
  assert.equal(r.totals.uncovered, 1);
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
