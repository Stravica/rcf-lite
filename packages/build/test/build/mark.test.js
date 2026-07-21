// Unit tests for the pure mark transition table (Phase 6 §D5, §3.4).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { planMark } from '../../src/build/mark.js';
import { isRcfError } from '../../src/errors/index.js';

function treeWith(status) {
  const fbs = { fbsId: 'FBS-001', executionStatus: status };
  return {
    byId: new Map([['FBS-001', fbs]]),
    kindById: new Map([['FBS-001', 'fbs']]),
  };
}

test('every legal single-step forward transition produces an executable plan', () => {
  const steps = [
    ['notStarted', 'inProgress'],
    ['inProgress', 'complete'],
    ['complete', 'verified'],
  ];
  for (const [from, to] of steps) {
    const plan = planMark(treeWith(from), { fbsId: 'FBS-001', status: to });
    assert.deepEqual(plan, { fbsId: 'FBS-001', from, to, noOp: false }, `${from} -> ${to}`);
  }
});

test('forward jumps are legal (notStarted -> complete, notStarted -> verified, inProgress -> verified)', () => {
  const jumps = [
    ['notStarted', 'complete'],
    ['notStarted', 'verified'],
    ['inProgress', 'verified'],
  ];
  for (const [from, to] of jumps) {
    const plan = planMark(treeWith(from), { fbsId: 'FBS-001', status: to });
    assert.equal(plan.noOp, false, `${from} -> ${to}`);
    assert.equal(plan.refused, undefined, `${from} -> ${to}`);
  }
});

test('every backward transition is refused with the rcf update escape hatch named', () => {
  const backward = [
    ['inProgress', 'notStarted'],
    ['complete', 'notStarted'],
    ['complete', 'inProgress'],
    ['verified', 'notStarted'],
    ['verified', 'inProgress'],
    ['verified', 'complete'],
  ];
  for (const [from, to] of backward) {
    const plan = planMark(treeWith(from), { fbsId: 'FBS-001', status: to });
    assert.equal(plan.refused, true, `${from} -> ${to}`);
    assert.match(plan.message, /rcf update FBS-001 --set executionStatus=/, `${from} -> ${to}`);
  }
});

test('same-status marking is an idempotent no-op for every status', () => {
  for (const status of ['notStarted', 'inProgress', 'complete', 'verified']) {
    const plan = planMark(treeWith(status), { fbsId: 'FBS-001', status });
    assert.deepEqual(plan, { fbsId: 'FBS-001', from: status, to: status, noOp: true });
  }
});

test('unknown --mark value returns a usage error naming the enum', () => {
  const result = planMark(treeWith('notStarted'), { fbsId: 'FBS-001', status: 'done' });
  assert.equal(isRcfError(result), true);
  assert.equal(result.kind, 'usage');
  assert.match(result.message, /notStarted \| inProgress \| complete \| verified/);
});

test('unknown id returns a usage error', () => {
  const result = planMark(treeWith('notStarted'), { fbsId: 'FBS-999', status: 'complete' });
  assert.equal(isRcfError(result), true);
  assert.equal(result.kind, 'usage');
});

test('a non-FBS id returns a usage error', () => {
  const tree = {
    byId: new Map([['US-101', { usId: 'US-101' }]]),
    kindById: new Map([['US-101', 'userStory']]),
  };
  const result = planMark(tree, { fbsId: 'US-101', status: 'complete' });
  assert.equal(isRcfError(result), true);
  assert.equal(result.kind, 'usage');
});

test('planMark never mutates the tree (plan, not write)', () => {
  const tree = treeWith('notStarted');
  planMark(tree, { fbsId: 'FBS-001', status: 'complete' });
  assert.equal(tree.byId.get('FBS-001').executionStatus, 'notStarted');
});
