import { test } from 'node:test';
import assert from 'node:assert/strict';

// Dynamic imports keep each test's failure its own.
test('C1 toMs reads a duration through ms', async () => {
  const { toMs } = await import('../src/index.js');
  assert.equal(await toMs('2s'), 2000);
});

test('C2 readPort reads the package fixture', async () => {
  const { readPort } = await import('../src/index.js');
  assert.equal(readPort(), 8080);
});

test('C3 greet comes from the workspace library', async () => {
  const { greet } = await import('@ws/lib');
  assert.equal(greet('ws'), 'hello ws');
});
