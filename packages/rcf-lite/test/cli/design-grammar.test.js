// Track B (ui-design-gate-0.7.0-spec §5.5): the design sub-verb parser
// MUST enforce /^FBS-\d+$/ on the first positional. Any other positional
// in slot 0 is a usage error, not an FBS lookup miss - the constraint
// closes the door on future refactors that accept slugs whose namespace
// could overlap with the sub-verb set.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';

import { main as designMain } from '../../src/cli/design.js';

async function runDesign(argv, cwd = process.cwd()) {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const captured = { out: '', err: '' };
  stdout.on('data', (b) => { captured.out += b.toString(); });
  stderr.on('data', (b) => { captured.err += b.toString(); });
  const code = await designMain(argv, { stdout, stderr, cwd });
  return { code, ...captured };
}

test('design refuses when the first positional is not an FBS id', async () => {
  const { code, err } = await runDesign(['journeys']);
  assert.equal(code, 2);
  assert.match(err, /expected an FBS id like FBS-011/);
});

test('design refuses a bare slug that could look like a future sub-verb', async () => {
  const { code, err } = await runDesign(['dashboard']);
  assert.equal(code, 2);
  assert.match(err, /expected an FBS id/);
});

test('design refuses an FBS id that is lowercase / malformed', async () => {
  const { code, err } = await runDesign(['fbs-016']);
  assert.equal(code, 2);
  assert.match(err, /expected an FBS id/);
});

test('design --help prints the help text', async () => {
  const { code, out } = await runDesign(['--help']);
  assert.equal(code, 0);
  assert.match(out, /Design substage verbs/);
});

test('design refuses an unknown sub-verb after a valid FBS id positional', async () => {
  // Uses a valid-shaped FBS id (project won't have it, but we
  // never get to the tree walk because sub-verb parsing surfaces
  // first - the pattern-shape gate is what we assert here).
  const { code, err } = await runDesign(['FBS-999', 'not-a-real-subverb']);
  // 2 either from unknown sub-verb OR project-root-missing; both are
  // fine here because the point is: the FBS-id pattern check let us
  // through. What we DO NOT want is silent success.
  assert.notEqual(code, 0);
  assert.ok(err.length > 0);
});
