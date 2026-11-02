import { test } from 'node:test';
import assert from 'node:assert/strict';

// Reads apps/api/fixtures/config.json relative to the rcf project root.
test('R1 readRootPort reads from the rcf project root', async () => {
  const { readRootPort } = await import('../src/index.js');
  assert.equal(readRootPort(), 8080);
});
