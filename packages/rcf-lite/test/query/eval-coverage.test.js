// Unit tests for computeEvalCoverage. Covers the four outcome buckets
// (covered, covered-optional, missing, not-required) and the strict-
// gate identity (missingCount === 0 iff ok).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeEvalCoverage, classifyEvalDoc } from '../../src/query/eval-coverage.js';

function makeTree({ userStories = [], evals = [] } = {}) {
  const byId = new Map();
  const kindById = new Map();
  const evalByAcId = new Map();
  for (const us of userStories) {
    byId.set(us.usId, us);
    kindById.set(us.usId, 'userStory');
  }
  for (const evalDoc of evals) {
    byId.set(evalDoc.id, evalDoc);
    kindById.set(evalDoc.id, 'evalDoc');
    for (const acId of evalDoc.acIds ?? []) {
      const list = evalByAcId.get(acId) ?? [];
      list.push(evalDoc.id);
      evalByAcId.set(acId, list);
    }
  }
  return { byId, kindById, evalByAcId, userStories, requirements: [], evals };
}

test('nonDeterministic AC without a bound EVAL reports missing and fails the gate', () => {
  const tree = makeTree({
    userStories: [{
      usId: 'US-101',
      reqId: 'REQ-001',
      acceptanceCriteria: [{ id: 'AC-101-1', determinism: 'nonDeterministic' }],
    }],
  });
  const report = computeEvalCoverage(tree);
  assert.equal(report.nonDeterministicCount, 1);
  assert.equal(report.missingCount, 1);
  assert.equal(report.coveredCount, 0);
  assert.equal(report.ok, false);
  assert.equal(report.acs[0].outcome, 'missing');
  assert.equal(report.acs[0].evalStatus, 'absent');
});

test('nonDeterministic AC with a resolving EVAL reports covered and passes', () => {
  const tree = makeTree({
    userStories: [{
      usId: 'US-101', reqId: 'REQ-001',
      acceptanceCriteria: [{ id: 'AC-101-1', determinism: 'nonDeterministic' }],
    }],
    evals: [{
      id: 'EVAL-001',
      usId: 'US-101',
      acIds: ['AC-101-1'],
      status: 'approved',
      runRecord: [{ verdict: 'pass', runAt: '2026-09-04T10:00:00Z' }],
    }],
  });
  const report = computeEvalCoverage(tree);
  assert.equal(report.missingCount, 0);
  assert.equal(report.coveredCount, 1);
  assert.equal(report.ok, true);
  assert.equal(report.acs[0].outcome, 'covered');
  assert.equal(report.acs[0].evalId, 'EVAL-001');
});

test('deterministic AC (marker absent) is not-required; a bound EVAL flips outcome to covered-optional', () => {
  const tree1 = makeTree({
    userStories: [{
      usId: 'US-101', reqId: 'REQ-001',
      acceptanceCriteria: [{ id: 'AC-101-1' }],
    }],
  });
  const r1 = computeEvalCoverage(tree1);
  assert.equal(r1.acs[0].outcome, 'not-required');
  assert.equal(r1.acs[0].determinism, 'deterministic');
  assert.equal(r1.ok, true);
  assert.equal(r1.nonDeterministicCount, 0);

  const tree2 = makeTree({
    userStories: [{
      usId: 'US-101', reqId: 'REQ-001',
      acceptanceCriteria: [{ id: 'AC-101-1' }],
    }],
    evals: [{
      id: 'EVAL-001', usId: 'US-101', acIds: ['AC-101-1'], status: 'approved',
      runRecord: [{ verdict: 'pass', runAt: '2026-09-04T10:00:00Z' }],
    }],
  });
  const r2 = computeEvalCoverage(tree2);
  assert.equal(r2.acs[0].outcome, 'covered-optional');
  assert.equal(r2.ok, true);
});

test('EVAL with a pending runRecord entry is not resolving; nonDeterministic AC reports missing', () => {
  const tree = makeTree({
    userStories: [{
      usId: 'US-101', reqId: 'REQ-001',
      acceptanceCriteria: [{ id: 'AC-101-1', determinism: 'nonDeterministic' }],
    }],
    evals: [{
      id: 'EVAL-001', usId: 'US-101', acIds: ['AC-101-1'], status: 'approved',
      runRecord: [{ verdict: 'pending', runAt: '2026-09-04T10:00:00Z' }],
    }],
  });
  const report = computeEvalCoverage(tree);
  assert.equal(report.acs[0].evalStatus, 'pending');
  assert.equal(report.acs[0].outcome, 'missing');
  assert.equal(report.ok, false);
});

test('superseded EVAL never counts as resolving', () => {
  const evalDoc = { status: 'superseded', runRecord: [{ verdict: 'pass', runAt: '2026-01-01T00:00:00Z' }] };
  assert.equal(classifyEvalDoc(evalDoc), 'superseded');
});

test('an EVAL with no runRecord entries is pending, not absent', () => {
  const evalDoc = { status: 'approved', runRecord: [] };
  assert.equal(classifyEvalDoc(evalDoc), 'pending');
});

test('scope-id restricts the report to the named US subtree', () => {
  const tree = makeTree({
    userStories: [
      { usId: 'US-101', reqId: 'REQ-001', acceptanceCriteria: [{ id: 'AC-101-1', determinism: 'nonDeterministic' }] },
      { usId: 'US-102', reqId: 'REQ-001', acceptanceCriteria: [{ id: 'AC-102-1' }] },
    ],
  });
  const report = computeEvalCoverage(tree, { scopeId: 'US-102' });
  assert.equal(report.acs.length, 1);
  assert.equal(report.acs[0].acId, 'AC-102-1');
  assert.equal(report.ok, true);
});
