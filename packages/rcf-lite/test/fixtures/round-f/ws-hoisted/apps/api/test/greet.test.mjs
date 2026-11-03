import { test } from 'node:test';
import assert from 'node:assert/strict';

// @ws/lib resolves through the rcf project root's node_modules, where npm's
// hoisted layout links the workspace package by name.
test('H1 greet comes from the hoisted workspace library', async () => {
  const { greet } = await import('@ws/lib');
  assert.equal(greet('Ada'), 'hello Ada');
  assert.equal(greet(''), 'hello');
});
