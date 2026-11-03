import { test } from 'node:test';
import assert from 'node:assert/strict';

// No package.json between this file and the rcf project root: it runs at the root.
test('R0 readRootPort reads from the rcf project root', async () => {
  const { readRootPort } = await import('../apps/api/src/index.js');
  assert.equal(readRootPort(), 8080);
});
