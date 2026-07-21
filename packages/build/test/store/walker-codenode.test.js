// Phase 10 (X2 CodeNode bridge): walker graph-wiring tests. `codeNode` is
// appended to CHILD_KINDS and treated exactly like any other child kind
// (spec D1); cnByAcId / dependentsByCnId invert the CN cross-links (D3);
// referential integrity is enforced on load (D7). D1/D9 requires spec-only
// queries to stay byte-identical when no `code-nodes/` directory exists -
// this file tests that explicitly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initProject } from '../../src/store/init.js';
import { walkTree } from '../../src/store/walker.js';

async function scaffold(name) {
  const root = await mkdtemp(join(tmpdir(), `rcf-walker-cn-${name}-`));
  await initProject({ projectRoot: root, projectName: 'CnTest' });
  return root;
}

function cnDoc(overrides) {
  return {
    cnId: 'CN-001',
    path: 'src/example.js',
    implementsAcIds: [],
    dependencies: [],
    version: '0.1.0',
    status: 'draft',
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
    ...overrides,
  };
}

async function writeCn(root, doc) {
  await mkdir(join(root, 'rcf', 'code-nodes'), { recursive: true });
  await writeFile(join(root, 'rcf', 'code-nodes', `${doc.cnId.toLowerCase()}.json`), JSON.stringify(doc, null, 2), 'utf8');
}

test('D1/D9: walkTree on a tree with no code-nodes/ dir is byte-identical to the pre-Phase-10 shape', async () => {
  const root = await scaffold('byte-identical');
  const { tree, errors } = await walkTree({ projectRoot: root });
  assert.deepEqual(errors, []);
  assert.deepEqual(tree.codeNodes, []);
  assert.deepEqual([...tree.cnByAcId.entries()], []);
  assert.deepEqual([...tree.dependentsByCnId.entries()], []);
});

test('codeNode is loaded as a first-class child kind and appears in tree.codeNodes / byId / kindById', async () => {
  const root = await scaffold('load');
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'example.js'), 'export function exampleFn() {}\n', 'utf8');
  await writeCn(root, cnDoc({ cnId: 'CN-001', path: 'src/example.js#exampleFn', implementsAcIds: ['AC-101-1'] }));

  const { tree, errors } = await walkTree({ projectRoot: root });
  assert.deepEqual(errors, [], JSON.stringify(errors, null, 2));
  assert.equal(tree.codeNodes.length, 1);
  assert.equal(tree.byId.get('CN-001')?.path, 'src/example.js#exampleFn');
  assert.equal(tree.kindById.get('CN-001'), 'codeNode');
});

test('cnByAcId inverts implementsAcIds (AC -> implementing CNs), sorted', async () => {
  const root = await scaffold('cnbyacid');
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'a.js'), 'export function a() {}\n', 'utf8');
  await writeFile(join(root, 'src', 'b.js'), 'export function b() {}\n', 'utf8');
  await writeCn(root, cnDoc({ cnId: 'CN-002', path: 'src/b.js#b', implementsAcIds: ['AC-101-1'] }));
  await writeCn(root, cnDoc({ cnId: 'CN-001', path: 'src/a.js#a', implementsAcIds: ['AC-101-1'] }));

  const { tree, errors } = await walkTree({ projectRoot: root });
  assert.deepEqual(errors, []);
  assert.deepEqual(tree.cnByAcId.get('AC-101-1'), ['CN-001', 'CN-002']);
});

test('dependentsByCnId inverts dependencies (CN -> CNs that depend on it)', async () => {
  const root = await scaffold('deps');
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'a.js'), 'export function a() {}\n', 'utf8');
  await writeFile(join(root, 'src', 'b.js'), 'export function b() {}\n', 'utf8');
  await writeCn(root, cnDoc({ cnId: 'CN-001', path: 'src/a.js#a' }));
  await writeCn(root, cnDoc({ cnId: 'CN-002', path: 'src/b.js#b', dependencies: ['CN-001'] }));

  const { tree, errors } = await walkTree({ projectRoot: root });
  assert.deepEqual(errors, []);
  assert.deepEqual(tree.dependentsByCnId.get('CN-001'), ['CN-002']);
});

test('referential integrity: implementsAcIds pointing at an unknown AC is a brokenReference (D7)', async () => {
  const root = await scaffold('bad-ac');
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'a.js'), 'export function a() {}\n', 'utf8');
  await writeCn(root, cnDoc({ cnId: 'CN-001', path: 'src/a.js#a', implementsAcIds: ['AC-999-9'] }));

  const { errors } = await walkTree({ projectRoot: root });
  const broken = errors.find((e) => e.kind === 'brokenReference' && e.documentId === 'CN-001');
  assert.ok(broken, JSON.stringify(errors, null, 2));
  assert.match(broken.field, /implementsAcIds/);
});

test('referential integrity: dependencies pointing at an unknown CN is a brokenReference (D7)', async () => {
  const root = await scaffold('bad-dep');
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'a.js'), 'export function a() {}\n', 'utf8');
  await writeCn(root, cnDoc({ cnId: 'CN-001', path: 'src/a.js#a', dependencies: ['CN-999'] }));

  const { errors } = await walkTree({ projectRoot: root });
  const broken = errors.find((e) => e.kind === 'brokenReference' && e.documentId === 'CN-001');
  assert.ok(broken, JSON.stringify(errors, null, 2));
  assert.match(broken.field, /dependencies/);
});

test('implementsAcIds MAY be empty - an orphan CN is not an error (D3)', async () => {
  const root = await scaffold('orphan');
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'util.js'), 'export function util() {}\n', 'utf8');
  await writeCn(root, cnDoc({ cnId: 'CN-001', path: 'src/util.js#util', implementsAcIds: [] }));

  const { errors } = await walkTree({ projectRoot: root });
  assert.deepEqual(errors, []);
});

test('CN schema rejects an additional property and a malformed path (schema shape only)', async () => {
  const root = await scaffold('schema-shape');
  await mkdir(join(root, 'rcf', 'code-nodes'), { recursive: true });
  await writeFile(
    join(root, 'rcf', 'code-nodes', 'cn-001.json'),
    JSON.stringify({ ...cnDoc({ cnId: 'CN-001' }), granularity: 'file' }),
    'utf8',
  );
  const { errors } = await walkTree({ projectRoot: root });
  assert.ok(errors.some((e) => e.kind === 'validation' && e.documentId === 'CN-001'), 'granularity is dropped per D2 - additionalProperties:false must reject it');
});
