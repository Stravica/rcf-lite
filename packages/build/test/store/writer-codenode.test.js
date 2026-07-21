// Phase 10 (X2 CodeNode bridge, D13): `rcf create/update/delete cn`
// writer-layer tests. CN mirrors the existing writer patterns: id
// allocation, post-write validation, delete-refused-while-depended-on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initProject } from '../../src/store/init.js';
import { walkTree } from '../../src/store/walker.js';
import { createDocument, deleteDocument, nextIdForKind, updateDocument } from '../../src/store/writer.js';

async function scaffold(name) {
  const projectRoot = await mkdtemp(join(tmpdir(), `rcf-writer-cn-${name}-`));
  await initProject({ projectRoot, projectName: 'WriterCnTest' });
  await mkdir(join(projectRoot, 'src'), { recursive: true });
  await writeFile(join(projectRoot, 'src', 'example.js'), 'export function exampleFn() {}\n', 'utf8');
  const { tree } = await walkTree({ projectRoot });
  return { projectRoot, tree };
}

async function reload(projectRoot) {
  return walkTree({ projectRoot });
}

test('nextIdForKind codeNode allocates a flat CN-NNN id', async () => {
  const { tree } = await scaffold('next-id');
  assert.equal(nextIdForKind(tree, 'codeNode'), 'CN-001');
});

test('createDocument cn: writes a file-level CN with defaults', async () => {
  const { projectRoot, tree } = await scaffold('create-file');
  const result = await createDocument({
    projectRoot, tree, kind: 'cn',
    body: { path: 'src/example.js' },
    options: {},
  });
  assert.equal(result.id, 'CN-001');
  assert.equal(result.filePath, 'rcf/code-nodes/cn-001.json');
  assert.equal(result.body.status, 'draft');
  assert.equal(result.body.version, '0.1.0');
  assert.deepEqual(result.body.implementsAcIds, []);
  assert.deepEqual(result.body.dependencies, []);

  const { tree: reloaded, errors } = await reload(projectRoot);
  assert.deepEqual(errors, []);
  assert.ok(reloaded.byId.has('CN-001'));
});

test('createDocument cn: symbol-level path with implementsAcIds', async () => {
  const { projectRoot, tree } = await scaffold('create-symbol');
  const result = await createDocument({
    projectRoot, tree, kind: 'cn',
    body: { path: 'src/example.js#exampleFn', implementsAcIds: ['AC-101-1'] },
    options: {},
  });
  assert.equal(result.body.path, 'src/example.js#exampleFn');
  assert.deepEqual(result.body.implementsAcIds, ['AC-101-1']);
});

test('createDocument cn: refuses when --path is missing', async () => {
  const { projectRoot, tree } = await scaffold('missing-path');
  const result = await createDocument({ projectRoot, tree, kind: 'cn', body: {}, options: {} });
  assert.equal(result.kind, 'usage');
  assert.match(result.message, /path is required/);
});

test('createDocument cn: refuses an implementsAcIds entry that does not resolve', async () => {
  const { projectRoot, tree } = await scaffold('bad-ac');
  const result = await createDocument({
    projectRoot, tree, kind: 'cn',
    body: { path: 'src/example.js', implementsAcIds: ['AC-999-9'] },
    options: {},
  });
  assert.equal(result.kind, 'brokenReference');
  assert.equal(result.field, 'implementsAcIds');
});

test('createDocument cn: refuses a self-referencing dependency', async () => {
  const { projectRoot, tree } = await scaffold('self-dep');
  const result = await createDocument({
    projectRoot, tree, kind: 'cn',
    body: { path: 'src/example.js', dependencies: ['CN-001'], id: 'CN-001' },
    options: { id: 'CN-001' },
  });
  assert.equal(result.kind, 'usage');
  assert.match(result.message, /own id/);
});

test('createDocument cn: dependencies must resolve to an existing CN', async () => {
  const { projectRoot, tree } = await scaffold('bad-dep');
  const result = await createDocument({
    projectRoot, tree, kind: 'cn',
    body: { path: 'src/example.js', dependencies: ['CN-999'] },
    options: {},
  });
  assert.equal(result.kind, 'brokenReference');
  assert.equal(result.field, 'dependencies');
});

test('createDocument cn: two nodes wire a real dependency edge', async () => {
  const { projectRoot, tree } = await scaffold('two-node');
  const first = await createDocument({
    projectRoot, tree, kind: 'cn', body: { path: 'src/example.js#exampleFn' }, options: {},
  });
  const { tree: tree2 } = await reload(projectRoot);
  const second = await createDocument({
    projectRoot, tree: tree2, kind: 'cn',
    body: { path: 'src/example.js', dependencies: [first.id] },
    options: {},
  });
  assert.equal(second.id, 'CN-002');
  assert.deepEqual(second.body.dependencies, ['CN-001']);
  const { tree: tree3, errors } = await reload(projectRoot);
  assert.deepEqual(errors, []);
  assert.deepEqual(tree3.dependentsByCnId.get('CN-001'), ['CN-002']);
});

test('updateDocument on a cn field-edits path (repair path)', async () => {
  const { projectRoot, tree } = await scaffold('update');
  await createDocument({ projectRoot, tree, kind: 'cn', body: { path: 'src/wrong.js' }, options: { id: 'CN-001' } });
  const { tree: tree2 } = await reload(projectRoot);
  const result = await updateDocument({
    projectRoot, tree: tree2, id: 'CN-001', sets: [{ path: 'path', value: 'src/example.js' }], options: {},
  });
  assert.equal(result.id, 'CN-001');
  assert.equal(result.body.path, 'src/example.js');
});

test('deleteDocument cn: refused while another CN depends on it (D13)', async () => {
  const { projectRoot, tree } = await scaffold('delete-refused');
  await createDocument({ projectRoot, tree, kind: 'cn', body: { path: 'src/example.js#exampleFn' }, options: { id: 'CN-001' } });
  const { tree: tree2 } = await reload(projectRoot);
  await createDocument({ projectRoot, tree: tree2, kind: 'cn', body: { path: 'src/example.js', dependencies: ['CN-001'] }, options: { id: 'CN-002' } });
  const { tree: tree3 } = await reload(projectRoot);
  const result = await deleteDocument({ projectRoot, tree: tree3, id: 'CN-001', options: {} });
  assert.equal(result.kind, 'usage');
  assert.equal(result.rule, 'dependents');
});

test('deleteDocument cn: --cascade drops the dependency edge and deletes the file', async () => {
  const { projectRoot, tree } = await scaffold('delete-cascade');
  await createDocument({ projectRoot, tree, kind: 'cn', body: { path: 'src/example.js#exampleFn' }, options: { id: 'CN-001' } });
  const { tree: tree2 } = await reload(projectRoot);
  await createDocument({ projectRoot, tree: tree2, kind: 'cn', body: { path: 'src/example.js', dependencies: ['CN-001'] }, options: { id: 'CN-002' } });
  const { tree: tree3 } = await reload(projectRoot);
  const result = await deleteDocument({ projectRoot, tree: tree3, id: 'CN-001', options: { cascade: true } });
  assert.deepEqual(result.deleted, ['CN-001']);
  const { tree: tree4, errors } = await reload(projectRoot);
  assert.deepEqual(errors, []);
  assert.ok(!tree4.byId.has('CN-001'));
  assert.deepEqual(tree4.byId.get('CN-002').dependencies, []);
});

test('deleteDocument cn: an orphan CN (no dependents) deletes cleanly without --cascade', async () => {
  const { projectRoot, tree } = await scaffold('delete-plain');
  await createDocument({ projectRoot, tree, kind: 'cn', body: { path: 'src/example.js' }, options: { id: 'CN-001' } });
  const { tree: tree2 } = await reload(projectRoot);
  const result = await deleteDocument({ projectRoot, tree: tree2, id: 'CN-001', options: {} });
  assert.deepEqual(result.deleted, ['CN-001']);
});
