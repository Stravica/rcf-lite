import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Every run writes into the sibling package's node_modules, through
// whatever ../b/node_modules/bpkg resolves to from the run's directory.
test('B1 double doubles, and the run writes under the sibling package node_modules', async () => {
  const { double } = await import('../src/index.js');
  assert.equal(double(2), 4);
  writeFileSync(join(realpathSync('../b/node_modules/bpkg'), 'w.txt'), 'w');
});
