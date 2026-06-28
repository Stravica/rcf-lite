import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initProject } from '../../src/store/init.js';
import { walkTree } from '../../src/store/walker.js';

test('initProject scaffolds a fresh tree', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-init-fresh-'));
  const result = await initProject({ projectRoot: root, projectName: 'Demo' });
  assert.ok(result.created);
  assert.ok(result.created.includes('rcf/manifest.json'));
  const manifest = JSON.parse(await readFile(join(root, 'rcf', 'manifest.json'), 'utf8'));
  assert.equal(manifest.projectName, 'Demo');
  assert.equal(manifest.prd.id, 'PRD-001');
});

test('initProject refuses to overwrite an existing manifest (AC-101-2)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-init-existing-'));
  await initProject({ projectRoot: root });
  const result = await initProject({ projectRoot: root });
  assert.equal(result.kind, 'usage');
  assert.match(result.message, /already exists/);
});

test('initProject refuses to overwrite without touching anything else', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-init-no-touch-'));
  await initProject({ projectRoot: root });
  const before = JSON.parse(await readFile(join(root, 'rcf', 'manifest.json'), 'utf8'));
  await initProject({ projectRoot: root, projectName: 'Different' });
  const after = JSON.parse(await readFile(join(root, 'rcf', 'manifest.json'), 'utf8'));
  assert.deepEqual(before, after);
});

test('initProject rejects empty projectRoot', async () => {
  const result = await initProject({ projectRoot: '' });
  assert.equal(result.kind, 'usage');
});

test('initProject + walkTree yields a clean tree (AC-101-1, AC-101-3)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-init-walk-'));
  await initProject({ projectRoot: root, projectName: 'Demo' });
  const { tree, errors } = await walkTree({ projectRoot: root });
  assert.deepEqual(errors, []);
  assert.equal(tree.prd?.prdId, 'PRD-001');
  assert.equal(tree.tad?.tadId, 'TAD-001');
  assert.equal(tree.bs?.bsId, 'BS-001');
  assert.equal(tree.requirements.length, 1);
  assert.equal(tree.userStories.length, 1);
  assert.equal(tree.tacs.length, 1);
  assert.equal(tree.adrs.length, 1);
  assert.equal(tree.fbsItems.length, 1);
});

test('initProject creates the expected directory layout', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-init-dirs-'));
  await initProject({ projectRoot: root });
  for (const sub of ['requirements', 'user-stories', 'tacs', 'adrs', 'fbs']) {
    const s = await stat(join(root, 'rcf', sub));
    assert.ok(s.isDirectory(), `${sub} should be a directory`);
  }
});
