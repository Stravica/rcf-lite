// Builder hygiene test (FBS-242, the stage-keeper's ruling on re-Review 3:
// the backstop covers the resolution path): rcf audit test-strength
// compares the project tree and every node_modules directory on Node's
// module resolution path above the project, up to the repository root
// (src/audit/test-strength/runner.js resolutionPath and backstopTree), and
// names a path above the project relative to it. This pins the directory
// set and the naming on a nested layout. It tests code hygiene only, is
// bound to no test case, and sits outside the RCF suite.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backstopTree, firstMoved, resolutionPath } from '../../src/audit/test-strength/runner.js';

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
  const outside = resolutionPath(join(root, 'ws/pkg'), join(root, 'ws/pkg/node_modules'));
  assert.equal(outside.at(-1), '/node_modules', 'a repository root that does not hold the project: up to the filesystem root');
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
