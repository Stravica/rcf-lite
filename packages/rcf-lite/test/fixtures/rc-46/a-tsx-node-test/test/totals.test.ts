import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sumTotals } from '../src/index.ts';

describe('totals', () => {
  it('sums the line items', () => {
    const items: number[] = [2, 3, 5];
    assert.equal(sumTotals(items), 10);
  });
});
