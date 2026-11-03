import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { welcome } from '../src/index.js';

// Reads a path relative to the rcf project root, so its run at apps/api,
// its package directory, is red for that alone (round F, F-9 with C9: the
// notice line follows the "cwd": "project" hint).
test('H3 welcome greets the package named in apps/api/package.json, read from the rcf project root', () => {
  const { name } = JSON.parse(readFileSync('apps/api/package.json', 'utf8'));
  assert.equal(welcome(name), 'hello @ws/api, welcome');
});
