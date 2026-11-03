import { test } from 'node:test';
import assert from 'node:assert/strict';

test('P1 readPort reads the package fixture', async () => {
  const { readPort } = await import('../src/index.js');
  assert.equal(readPort(), 8080);
});
