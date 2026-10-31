import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import * as intervals from '../../../../src/intervals.js';

describe('AC-101-1: two intervals overlap only when they share a point, and touching ends do not overlap', () => {
  it('TC-001: intervals that share a stretch overlap, in either order', () => {
    const a = { start: 0, end: 10 };
    const b = { start: 5, end: 15 };
    assert.equal(intervals.overlaps(a, b), true);
    assert.equal(intervals.overlaps(b, a), true);
  });

  it('TC-002: an interval inside another overlaps it', () => {
    assert.equal(intervals.overlaps({ start: 0, end: 10 }, { start: 3, end: 4 }), true);
  });

  it('TC-003: intervals that only touch at an end do not overlap', () => {
    assert.equal(intervals.overlaps({ start: 0, end: 5 }, { start: 5, end: 9 }), false);
    assert.equal(intervals.overlaps({ start: 5, end: 9 }, { start: 0, end: 5 }), false);
  });

  it('TC-004: disjoint intervals do not overlap', () => {
    assert.equal(intervals.overlaps({ start: 0, end: 2 }, { start: 7, end: 9 }), false);
  });

  it('TC-005: an empty interval overlaps nothing, even inside another', () => {
    assert.equal(intervals.overlaps({ start: 4, end: 4 }, { start: 0, end: 10 }), false);
  });
});
