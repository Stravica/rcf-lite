// Builder hygiene test (FBS-242, the stage-keeper's ruling on re-Review 3
// and the design decision after re-Review 4: the backstop is a set of
// forbidden roots resolved by real path): rcf audit test-strength compares
// every path under the project root, the real location of its node_modules,
// each ancestor's node_modules up to the repository root (the stop) and the
// .git (src/audit/test-strength/runner.js resolutionPath, forbiddenRoots,
// backstopTree and firstForbidden), and names a path above the project
// relative to it. This pins the directory set and the naming on a nested
// layout and through a linked node_modules. It tests code hygiene only, is
// bound to no test case, and sits outside the RCF suite.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backstopTree, firstForbidden, firstMoved, forbiddenRoots, resolutionPath } from '../../src/audit/test-strength/runner.js';

function layout(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'rcf-hyg-resolve-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const d of ['node_modules/rootpkg', 'ws/node_modules/wspkg', 'ws/node_modules/inner/pkg', 'ws/pkg/node_modules/own']) mkdirSync(join(root, d), { recursive: true });
  return root;
}

test('hygiene: the resolution path is each ancestor\'s node_modules from the project\'s parent up to the repository root, a directory named node_modules skipped', (t) => {
  const root = layout(t);
  assert.deepEqual(resolutionPath(join(root, 'ws/pkg'), root), [join(root, 'ws/node_modules'), join(root, 'node_modules')]);
  assert.deepEqual(resolutionPath(join(root, 'ws/node_modules/inner/pkg'), root), [join(root, 'ws/node_modules/inner/node_modules'), join(root, 'ws/node_modules'), join(root, 'node_modules')]);
  assert.deepEqual(resolutionPath(root, root), [], 'the project at the repository root has no ancestor on the path');
  assert.deepEqual(resolutionPath(join(root, 'ws/pkg'), join(root, 'ws')), [join(root, 'ws/node_modules')], 'the repository root is the stop: nothing above it');
});

test('hygiene: the backstop tree names a write in an ancestor\'s node_modules relative to the project, and a node_modules created on the path', (t) => {
  const root = layout(t);
  const project = join(root, 'ws/pkg');
  const before = backstopTree(project, root);
  assert.equal(before.get('../../node_modules/rootpkg'), 'dir');
  assert.equal(before.get('node_modules/own'), 'dir');
  writeFileSync(join(root, 'node_modules/rootpkg/a6.txt'), 'a6');
  assert.equal(firstMoved(before, backstopTree(project, root)), '../../node_modules/rootpkg/a6.txt');
  const bare = join(root, 'bare/pkg');
  mkdirSync(bare, { recursive: true });
  const empty = backstopTree(bare, root);
  mkdirSync(join(root, 'bare/node_modules'));
  assert.equal(firstMoved(empty, backstopTree(bare, root)), '../node_modules');
});

test('hygiene: the forbidden roots are resolved by real path: a linked project node_modules is read at its target, a write there is named through the link, a scratch directory is not a forbidden root', (t) => {
  const root = layout(t);
  const away = realpathSync(mkdtempSync(join(tmpdir(), 'rcf-hyg-away-')));
  t.after(() => rmSync(away, { recursive: true, force: true }));
  mkdirSync(join(away, 'nm/vitest'), { recursive: true });
  const project = join(root, 'linked');
  mkdirSync(project);
  symlinkSync(join(away, 'nm'), join(project, 'node_modules'), 'dir');
  const roots = forbiddenRoots(project, root);
  assert.deepEqual(roots.map((r) => r.name), ['', 'node_modules', '../node_modules', '../.git']);
  assert.equal(roots[1].real, join(away, 'nm'));
  const before = backstopTree(project, root, roots);
  writeFileSync(join(away, 'nm/vitest/x3b.txt'), 'x');
  assert.equal(firstForbidden(roots, before, backstopTree(project, root, roots)), 'node_modules/vitest/x3b.txt');
  assert.equal(firstForbidden(roots, before, backstopTree(project, root, roots), [join(away, 'nm')]), null, 'a path under a scratch directory is not forbidden');
  assert.deepEqual(forbiddenRoots(join(root, 'ws/pkg'), root).map((r) => r.name), ['', '../node_modules', '../../node_modules', '../../.git'], 'a node_modules inside the project is read with the project root');
});
