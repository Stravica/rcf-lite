import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';

// Round F (F-2): each run appends a line to the file RCF_ROUND_F_WITNESS
// names, when it is set, so a test can tell whether the audit ran it.
test('W1 toMs reads a duration through ms, and each run is recorded', async () => {
  if (process.env.RCF_ROUND_F_WITNESS) appendFileSync(process.env.RCF_ROUND_F_WITNESS, 'ran\n');
  const { toMs } = await import('../src/index.js');
  assert.equal(await toMs('2s'), 2000);
});
