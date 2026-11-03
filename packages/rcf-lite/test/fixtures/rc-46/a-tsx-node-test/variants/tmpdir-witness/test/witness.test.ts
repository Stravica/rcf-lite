import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { sumTotals } from '../src/index.ts';

// Round F (F-7 darwin, AC-19904-12): each run appends the TMPDIR it sees,
// the runner's scratch directory, to the file RCF_ROUND_F_TMPDIR_WITNESS
// names, when it is set, before it calls the code under test.
describe('totals', () => {
  it('records its TMPDIR and sums the line items', () => {
    if (process.env.RCF_ROUND_F_TMPDIR_WITNESS) appendFileSync(process.env.RCF_ROUND_F_TMPDIR_WITNESS, `${process.env.TMPDIR}\n`);
    const items: number[] = [2, 3, 5];
    assert.equal(sumTotals(items), 10);
  });
});
