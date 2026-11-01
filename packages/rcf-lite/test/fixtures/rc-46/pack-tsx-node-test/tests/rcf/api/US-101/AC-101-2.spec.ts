import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import * as intervals from '../../../../src/intervals.js';

describe('AC-101-2: merging combines overlapping and touching intervals into a sorted disjoint list and rejects a malformed interval', () => {
  it('TC-001: overlapping intervals given out of order merge into one sorted list', () => {
    const merged = intervals.mergeIntervals([
      { start: 20, end: 30 },
      { start: 0, end: 10 },
      { start: 5, end: 12 },
    ]);
    assert.deepEqual(merged, [
      { start: 0, end: 12 },
      { start: 20, end: 30 },
    ]);
  });

  it('TC-002: touching intervals combine into one', () => {
    assert.deepEqual(intervals.mergeIntervals([{ start: 0, end: 5 }, { start: 5, end: 8 }]), [{ start: 0, end: 8 }]);
  });

  it('TC-003: empty intervals are dropped and an empty list merges to an empty list', () => {
    assert.deepEqual(intervals.mergeIntervals([{ start: 3, end: 3 }]), []);
    assert.deepEqual(intervals.mergeIntervals([]), []);
  });

  it('TC-004: the inputs are not changed', () => {
    const input = [{ start: 5, end: 9 }, { start: 1, end: 6 }];
    intervals.mergeIntervals(input);
    assert.deepEqual(input, [{ start: 5, end: 9 }, { start: 1, end: 6 }]);
  });

  it('TC-005: an interval whose end is before its start rejects the merge with a RangeError', () => {
    assert.throws(() => intervals.mergeIntervals([{ start: 0, end: 4 }, { start: 9, end: 2 }]), RangeError);
  });

  it('TC-006: assertInterval accepts a well-formed or empty interval and rejects non-finite bounds', () => {
    assert.doesNotThrow(() => intervals.assertInterval({ start: 1, end: 2 }));
    assert.doesNotThrow(() => intervals.assertInterval({ start: 2, end: 2 }));
    assert.throws(() => intervals.assertInterval({ start: 0, end: Number.POSITIVE_INFINITY }), RangeError);
    assert.throws(() => intervals.assertInterval({ start: 3, end: 1 }), RangeError);
  });
});
