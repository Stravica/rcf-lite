import { test } from 'node:test';
import assert from 'node:assert/strict';

test('T1 clampPort keeps a port in range', async () => {
  const { clampPort } = await import('../src/index.js');
  assert.equal(clampPort(8080), 8080);
  assert.equal(clampPort(0), 80);
});
