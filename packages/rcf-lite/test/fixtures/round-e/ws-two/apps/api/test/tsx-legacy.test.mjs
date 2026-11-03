import { test } from 'node:test';
import assert from 'node:assert/strict';

// Run by the legacy runner, whose argv starts with a bare tsx.
test('L1 clampPort keeps a port in range under the legacy runner', async () => {
  const { clampPort } = await import('../src/index.js');
  assert.equal(clampPort(8080), 8080);
  assert.equal(clampPort(0), 80);
});
