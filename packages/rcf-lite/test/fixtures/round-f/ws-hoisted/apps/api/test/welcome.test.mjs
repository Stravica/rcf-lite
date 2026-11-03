import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { welcome } from '../src/index.js';

// The api's own code, which imports @ws/lib by name (round F, F-9). When
// RCF_ROUND_F_WITNESS is set, each run first appends the real path of the
// file @ws/lib resolves to from here, so a test can tell which package
// the run loaded.
test('H2 welcome greets through the workspace library', () => {
  if (process.env.RCF_ROUND_F_WITNESS) appendFileSync(process.env.RCF_ROUND_F_WITNESS, `${realpathSync(fileURLToPath(import.meta.resolve('@ws/lib')))}\n`);
  assert.equal(welcome('Ada'), 'hello Ada, welcome');
  assert.equal(welcome(''), 'hello, welcome');
});
