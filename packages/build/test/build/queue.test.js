// Unit tests for the pure queue module (Phase 6 §D2, §3.4). Uses small
// hand-built TreeModel-shaped fixtures, same pattern as test/query.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeQueue, selectNext } from '../../src/build/queue.js';

/**
 * Build a minimal TreeModel-like object for queue computation. Only
 * `fbsItems` and `bs` are consumed.
 */
function makeTree({ fbsItems = [], bs = null } = {}) {
  return { fbsItems, bs };
}

function fbs(fbsId, buildOrder, executionStatus, dependsOnFbsIds = [], title = `Title ${fbsId}`) {
  return { fbsId, buildOrder, executionStatus, dependsOnFbsIds, title };
}

test('notStarted with no dependencies is actionable', () => {
  const q = computeQueue(makeTree({ fbsItems: [fbs('FBS-001', 1, 'notStarted')] }));
  assert.equal(q.items[0].state, 'actionable');
  assert.deepEqual(q.items[0].blockedBy, []);
  assert.equal(q.nextActionable, 'FBS-001');
});

test('notStarted with an unsatisfied dependency is blocked, blockedBy names it', () => {
  const q = computeQueue(makeTree({
    fbsItems: [fbs('FBS-001', 1, 'notStarted'), fbs('FBS-002', 2, 'notStarted', ['FBS-001'])],
  }));
  assert.equal(q.items[1].state, 'blocked');
  assert.deepEqual(q.items[1].blockedBy, ['FBS-001']);
});

test('complete AND verified dependencies both satisfy (D2 rule 2)', () => {
  const q = computeQueue(makeTree({
    fbsItems: [
      fbs('FBS-001', 1, 'complete'),
      fbs('FBS-002', 2, 'verified'),
      fbs('FBS-003', 3, 'notStarted', ['FBS-001', 'FBS-002']),
    ],
  }));
  assert.equal(q.items[2].state, 'actionable');
  assert.equal(q.nextActionable, 'FBS-003');
});

test('inProgress is neither actionable nor blocked; selectNext skips it', () => {
  const q = computeQueue(makeTree({
    fbsItems: [fbs('FBS-001', 1, 'inProgress'), fbs('FBS-002', 2, 'notStarted')],
  }));
  assert.equal(q.items[0].state, 'inProgress');
  assert.equal(selectNext(q).fbsId, 'FBS-002');
});

test('an inProgress dependency does NOT satisfy - dependent stays blocked', () => {
  const q = computeQueue(makeTree({
    fbsItems: [fbs('FBS-001', 1, 'inProgress'), fbs('FBS-002', 2, 'notStarted', ['FBS-001'])],
  }));
  assert.equal(q.items[1].state, 'blocked');
  assert.deepEqual(q.items[1].blockedBy, ['FBS-001']);
  assert.equal(q.nextActionable, null);
});

test('items sort by buildOrder ascending regardless of input order', () => {
  const q = computeQueue(makeTree({
    fbsItems: [fbs('FBS-003', 3, 'notStarted'), fbs('FBS-001', 1, 'notStarted'), fbs('FBS-002', 2, 'notStarted')],
  }));
  assert.deepEqual(q.items.map((i) => i.fbsId), ['FBS-001', 'FBS-002', 'FBS-003']);
});

test('duplicate buildOrder breaks ties by fbsId lexicographic ascending', () => {
  const q = computeQueue(makeTree({
    fbsItems: [fbs('FBS-00B', 1, 'notStarted'), fbs('FBS-00A', 1, 'notStarted')],
  }));
  assert.deepEqual(q.items.map((i) => i.fbsId), ['FBS-00A', 'FBS-00B']);
  assert.equal(q.nextActionable, 'FBS-00A');
});

test('dependency cycle: every member is blocked (cycle), never a crash', () => {
  const q = computeQueue(makeTree({
    fbsItems: [
      fbs('FBS-001', 1, 'notStarted', ['FBS-002']),
      fbs('FBS-002', 2, 'notStarted', ['FBS-001']),
      fbs('FBS-003', 3, 'notStarted', ['FBS-002']),
    ],
  }));
  assert.equal(q.items[0].state, 'blocked');
  assert.equal(q.items[0].cycle, true);
  assert.equal(q.items[1].state, 'blocked');
  assert.equal(q.items[1].cycle, true);
  // FBS-003 is blocked BY the cycle but not a member of it.
  assert.equal(q.items[2].state, 'blocked');
  assert.equal(q.items[2].cycle, undefined);
  assert.equal(q.nextActionable, null);
});

test('self-dependency is a one-node cycle', () => {
  const q = computeQueue(makeTree({ fbsItems: [fbs('FBS-001', 1, 'notStarted', ['FBS-001'])] }));
  assert.equal(q.items[0].state, 'blocked');
  assert.equal(q.items[0].cycle, true);
});

test('totals: every counter derived correctly', () => {
  const q = computeQueue(makeTree({
    fbsItems: [
      fbs('FBS-001', 1, 'complete'),
      fbs('FBS-002', 2, 'verified'),
      fbs('FBS-003', 3, 'inProgress'),
      fbs('FBS-004', 4, 'notStarted'),
      fbs('FBS-005', 5, 'notStarted', ['FBS-004']),
    ],
  }));
  assert.deepEqual(q.totals, {
    items: 5, notStarted: 2, inProgress: 1, complete: 1, verified: 1, actionable: 1, blocked: 1,
  });
});

test('exhausted queue (all complete/verified): nextActionable null, zero actionable', () => {
  const q = computeQueue(makeTree({
    fbsItems: [fbs('FBS-001', 1, 'complete'), fbs('FBS-002', 2, 'verified')],
  }));
  assert.equal(q.nextActionable, null);
  assert.equal(q.totals.actionable, 0);
  assert.equal(q.totals.blocked, 0);
  assert.equal(selectNext(q), null);
});

test('selectNext picks the lowest-buildOrder actionable item', () => {
  const q = computeQueue(makeTree({
    fbsItems: [
      fbs('FBS-001', 1, 'complete'),
      fbs('FBS-005', 5, 'notStarted'),
      fbs('FBS-003', 3, 'notStarted'),
    ],
  }));
  assert.equal(selectNext(q).fbsId, 'FBS-003');
});

test('blockedBy sorts by buildOrder then fbsId', () => {
  const q = computeQueue(makeTree({
    fbsItems: [
      fbs('FBS-009', 9, 'notStarted'),
      fbs('FBS-002', 2, 'notStarted'),
      fbs('FBS-001', 1, 'notStarted', ['FBS-009', 'FBS-002']),
    ],
  }));
  const item = q.items.find((i) => i.fbsId === 'FBS-001');
  assert.deepEqual(item.blockedBy, ['FBS-002', 'FBS-009']);
});

test('bs block carries bsId / title / generationStrategy; null when absent', () => {
  const withBs = computeQueue(makeTree({
    fbsItems: [],
    bs: { bsId: 'BS-001', title: 'Plan', generationStrategy: 'dependencyFirst', buildPhilosophy: 'x' },
  }));
  assert.deepEqual(withBs.bs, { bsId: 'BS-001', title: 'Plan', generationStrategy: 'dependencyFirst' });
  const withoutBs = computeQueue(makeTree({ fbsItems: [] }));
  assert.equal(withoutBs.bs, null);
});
