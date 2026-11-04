import { test } from 'node:test';
import assert from 'node:assert/strict';

// No package.json between this file and the rcf project root: it runs at
// the root, where the package-relative fixtures/config.json readPort reads
// is missing, so it is red there (round F, F-1).
test('R2 readPort reads the package fixture from the rcf project root', async () => {
  const { readPort } = await import('../apps/api/src/index.js');
  assert.equal(readPort(), 8080);
});
