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

// ---------------------------------------------------------------------------
// AC-17401-10: ## Surface section seeded so a fresh `rcf init` passes
// checkD1Brief's profile:surface marker without operator edits.
// w-2026-09-25-dave-004 defect B.
// ---------------------------------------------------------------------------

import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IDENTITY_TEMPLATE as _T, writeIdentityTemplate, identityProfilePath } from '../../src/setup/identity-seed.js';

test('IDENTITY_TEMPLATE carries a ## Surface heading between ## Register and ## Project-scoped notes', () => {
  const regIdx = _T.indexOf('## Register');
  const surfIdx = _T.indexOf('## Surface');
  const psnIdx = _T.indexOf('## Project-scoped notes');
  assert.ok(regIdx > 0, '## Register heading missing');
  assert.ok(surfIdx > regIdx, '## Surface must sit under ## Register');
  assert.ok(psnIdx > surfIdx, '## Surface must sit above ## Project-scoped notes');
});

test('IDENTITY_TEMPLATE Surface section names all three values and seeds to prDiff', () => {
  const block = _T.slice(
    _T.indexOf('## Surface'),
    _T.indexOf('## Project-scoped notes'),
  );
  assert.match(block, /`viewer`/);
  assert.match(block, /`runningApp`/);
  assert.match(block, /`prDiff`/);
  // The seeded default line: a bare `prDiff` line above the next
  // section so a hand-edit is one word away.
  assert.match(block, /\nprDiff\n/);
});

test('a fresh writeIdentityTemplate call seeds a profile that satisfies checkD1Brief surfaceMarkers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-identity-surface-'));
  const result = await writeIdentityTemplate({ projectRoot: root });
  assert.equal(result.action, 'created');
  const body = await readFile(identityProfilePath(root), 'utf8');
  // Reproduce the exact surface-marker check checkD1Brief runs
  // (packages/rcf-lite/src/query/gates.js: surfaceMarkers.some(...)).
  const surfaceMarkers = ['viewer', 'runningApp', 'prDiff'];
  const registerMarkers = ['productOwner', 'engineer', 'unstated'];
  assert.ok(surfaceMarkers.some((m) => body.includes(m)), 'seeded profile missing surface marker');
  assert.ok(registerMarkers.some((m) => body.includes(m)), 'seeded profile missing register marker');
});

test('writeIdentityTemplate stays idempotent: an existing profile.md with no ## Surface is left byte-identical', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-identity-kept-'));
  const custom = '# My profile\n\nhand-written, no surface section here\n';
  await mkdir(join(root, 'rcf', '.identity'), { recursive: true });
  await writeFile(identityProfilePath(root), custom, 'utf8');
  const result = await writeIdentityTemplate({ projectRoot: root });
  assert.equal(result.action, 'kept');
  const after = await readFile(identityProfilePath(root), 'utf8');
  assert.equal(after, custom, 'existing profile must be left byte-identical');
});
