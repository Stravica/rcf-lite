// Unit tests for the pure mark transition table (Phase 6 §D5, §3.4).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { planMark } from '../../src/build/mark.js';
import { isRcfError } from '@stravica-ai/rcf-lite-core/errors';

function treeWith(status) {
  const fbs = { fbsId: 'FBS-001', executionStatus: status };
  return {
    byId: new Map([['FBS-001', fbs]]),
    kindById: new Map([['FBS-001', 'fbs']]),
  };
}

test('every legal single-step forward transition produces an executable plan', () => {
  // The mark ladder caps at `complete`; complete -> verified is no longer a
  // mark transition (it is the finalise gate's job), so it is not listed here.
  const steps = [
    ['notStarted', 'inProgress'],
    ['inProgress', 'complete'],
  ];
  for (const [from, to] of steps) {
    const plan = planMark(treeWith(from), { fbsId: 'FBS-001', status: to });
    assert.deepEqual(plan, { fbsId: 'FBS-001', from, to, noOp: false }, `${from} -> ${to}`);
  }
});

test('forward jumps up to complete are legal (notStarted -> complete)', () => {
  const jumps = [
    ['notStarted', 'complete'],
  ];
  for (const [from, to] of jumps) {
    const plan = planMark(treeWith(from), { fbsId: 'FBS-001', status: to });
    assert.equal(plan.noOp, false, `${from} -> ${to}`);
    assert.equal(plan.refused, undefined, `${from} -> ${to}`);
  }
});

test('--mark verified is refused from any status; the message names rcf finalise (mark ladder caps at complete)', () => {
  // The whole point of the hardening (w-2026-07-22-004): mark must never write
  // `verified` - that would sidestep the independent finalise gate.
  for (const from of ['notStarted', 'inProgress', 'complete', 'verified']) {
    const plan = planMark(treeWith(from), { fbsId: 'FBS-001', status: 'verified' });
    assert.equal(plan.refused, true, `${from} -> verified refuses`);
    assert.equal(plan.to, 'verified');
    assert.match(plan.message, /rcf finalise FBS-001/, `${from} -> verified names finalise`);
    // and still names the sanctioned manual override.
    assert.match(plan.message, /rcf update FBS-001 --set executionStatus=verified/, `${from} -> verified names rcf update`);
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

test('same-status marking is an idempotent no-op for every markable status', () => {
  // `verified` is excluded: it is never a --mark target (it refuses, covered
  // above), so re-marking an already-verified item is a refusal, not a no-op.
  for (const status of ['notStarted', 'inProgress', 'complete']) {
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
