// The identity profile template gains a `## Register` section under
// `## Working preferences`, seeded to `unstated` and carrying a
// one-sentence description of the three values so an operator can
// hand-edit the profile without reading the managed block (spec
// section 4.1, files-touched line for identity-seed.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { IDENTITY_TEMPLATE } from '../../src/setup/identity-seed.js';

test('IDENTITY_TEMPLATE carries a ## Register heading under ## Working preferences', () => {
  const wpIdx = IDENTITY_TEMPLATE.indexOf('## Working preferences');
  const regIdx = IDENTITY_TEMPLATE.indexOf('## Register');
  const psnIdx = IDENTITY_TEMPLATE.indexOf('## Project-scoped notes');
  assert.ok(wpIdx > 0, 'Working preferences heading missing');
  assert.ok(regIdx > wpIdx, '## Register must live under ## Working preferences');
  assert.ok(psnIdx > regIdx, '## Register must sit above ## Project-scoped notes');
});

test('IDENTITY_TEMPLATE Register section names all three values and seeds to unstated', () => {
  const block = IDENTITY_TEMPLATE.slice(
    IDENTITY_TEMPLATE.indexOf('## Register'),
    IDENTITY_TEMPLATE.indexOf('## Project-scoped notes'),
  );
  assert.match(block, /`productOwner`/);
  assert.match(block, /`engineer`/);
  assert.match(block, /`unstated`/);
  // The seeded default line: a bare `unstated` line above the closing
  // block boundary so a hand-edit is one word away.
  assert.match(block, /\nunstated\n/);
});
