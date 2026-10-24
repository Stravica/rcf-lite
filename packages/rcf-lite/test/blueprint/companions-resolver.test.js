// Unit tests for the companion-suggestion resolver (core-companions
// spec 2.3): deterministic tier ladder (applied > pinned > registered
// library > core shelf).
//
// Covers TS-043 TC-043-resolver-tier-ladder.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { initProject } from '../../src/core/store/init.js';
import { walkTree } from '../../src/core/store/walker.js';
import { applyBlueprint } from '../../src/blueprint/apply.js';
import { resolveCompanionRole, setCompanionPin } from '../../src/blueprint/companions.js';
import { declareUiNoneForTests } from '../_helpers/d0.js';
import { scratchDir } from '../_helpers/scratch.js';
import { ensurePackagedShelfStaged } from '../_helpers/packaged-shelf.js';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..', '..', '..');
const LOGGING_SHELF = join(REPO_ROOT, 'blueprints', 'observability-logging');

test('resolver returns shelf-fallback when only the core shelf provides the role', async () => {
  // The resolver reads the packaged shelf (packages/rcf-lite/blueprints/),
  // a generated directory: stage it here instead of relying on another
  // file having staged it, and never read it mid-stage (packaged-shelf.js).
  await ensurePackagedShelfStaged();
  const root = await scratchDir('rcf-resolver-shelf-');
  await initProject({ projectRoot: root, projectName: 'shelf' });
  await declareUiNoneForTests(root);
  const { tree } = await walkTree({ projectRoot: root });
  const r = await resolveCompanionRole({
    projectRoot: root,
    tree,
    suggestion: { role: 'logging', reason: 'x.' },
    pins: null,
  });
  assert.equal(r.origin, 'shelfFallback');
  assert.equal(r.provider, 'observability-logging');
});

test('resolver returns appliedProvider when the shelf blueprint is already applied', async () => {
  const root = await scratchDir('rcf-resolver-applied-');
  await initProject({ projectRoot: root, projectName: 'applied' });
  await declareUiNoneForTests(root);
  let { tree } = await walkTree({ projectRoot: root });
  await applyBlueprint({ projectRoot: root, tree, source: LOGGING_SHELF });
  ({ tree } = await walkTree({ projectRoot: root }));
  const r = await resolveCompanionRole({
    projectRoot: root,
    tree,
    suggestion: { role: 'logging', reason: 'x.' },
    pins: null,
  });
  assert.equal(r.origin, 'appliedProvider');
  assert.equal(r.provider, 'observability-logging');
});

test('resolver honours a pinnedShelf pin over a plain shelfFallback', async () => {
  const root = await scratchDir('rcf-resolver-pin-');
  await initProject({ projectRoot: root, projectName: 'pinned' });
  await declareUiNoneForTests(root);
  const pinRes = await setCompanionPin({ projectRoot: root, role: 'logging', provider: 'observability-logging' });
  assert.equal(pinRes.written, true);
  const { tree } = await walkTree({ projectRoot: root });
  const pins = { schemaVersion: 1, roles: { logging: { provider: 'observability-logging', pinnedAt: '2026-09-04T00:00:00Z' } } };
  const r = await resolveCompanionRole({
    projectRoot: root,
    tree,
    suggestion: { role: 'logging', reason: 'x.' },
    pins,
  });
  assert.equal(r.origin, 'pinnedShelf');
  assert.equal(r.provider, 'observability-logging');
});

test('resolver returns unresolved when no provider exists', async () => {
  const root = await scratchDir('rcf-resolver-unresolved-');
  await initProject({ projectRoot: root, projectName: 'unresolved' });
  await declareUiNoneForTests(root);
  const { tree } = await walkTree({ projectRoot: root });
  const r = await resolveCompanionRole({
    projectRoot: root,
    tree,
    suggestion: { role: 'notarole', reason: 'x.' },
    pins: null,
  });
  assert.equal(r.origin, 'unresolved');
  assert.equal(r.provider, null);
});
