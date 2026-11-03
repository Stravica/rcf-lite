import { test } from 'node:test';
import assert from 'node:assert/strict';
import { welcome } from '../src/index.js';

// The api's own code, which imports @ws/lib by name (round F, F-9).
test('H2 welcome greets through the workspace library', () => {
  assert.equal(welcome('Ada'), 'hello Ada, welcome');
  assert.equal(welcome(''), 'hello, welcome');
});
