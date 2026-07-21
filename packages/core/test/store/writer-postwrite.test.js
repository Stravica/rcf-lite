// B5 regression suite (E2E matrix 2026-07-06-003, cell p2-opus): the
// write-deadlock wedge. A malformed TS doc (TS-003) landed on disk; the
// old semantics pre-validated the CURRENT tree and refused every write
// verb - including the repair-update of that doc and the delete of that
// very doc. Operator-approved amendment: write verbs validate the
// POST-WRITE tree state; a delete is never blocked by validation errors
// attributable solely to the doc being deleted; net-new breakage is
// still refused.
//
// Scenarios per the fix-cycle-2 brief:
//   (a) construct the wedge on disk (malformed doc in an otherwise-valid tree)
//   (b) repair-update of the malformed doc SUCCEEDS
//   (c) delete of the malformed doc SUCCEEDS
//   (d) a write introducing net-new breakage on the broken tree still REFUSES
//   (e) normal-path refusals (invalid doc into a valid tree) still refuse

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initProject } from '../../src/store/init.js';
import { walkTree } from '../../src/store/walker.js';
import {
  createDocument, deleteDocument, nextIdForKind, updateDocument,
} from '../../src/store/writer.js';

// The exact TS-003 wedge shape: a test suite whose `status` fails the
// schema enum. Everything else about the tree stays scaffold-valid.
const MALFORMED_TS_003 = {
  id: 'TS-003',
  usId: 'US-101',
  title: 'Wedged suite',
  purpose: 'Reproduces the p2-opus wedge',
  testLevel: 'unit',
  acIds: ['AC-101-1'],
  testCases: [],
  status: 'NOT-A-STATUS',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

async function scaffoldWedge() {
  const projectRoot = await mkdtemp(join(tmpdir(), 'rcf-b5-wedge-'));
  await initProject({ projectRoot, projectName: 'B5WedgeTest' });
  await writeFile(
    join(projectRoot, 'rcf/test-suites/ts-003.json'),
    `${JSON.stringify(MALFORMED_TS_003, null, 2)}\n`,
    'utf8',
  );
  const { tree, errors } = await walkTree({ projectRoot });
  return { projectRoot, tree, errors };
}

async function fileExists(path) {
  try { await access(path); return true; } catch { return false; }
}

test('(a) the wedge state is representable: walk reports the validation error but keeps the doc addressable', async () => {
  const { tree, errors } = await scaffoldWedge();
  assert.equal(errors.length, 1);
  assert.equal(errors[0].kind, 'validation');
  assert.equal(errors[0].documentId, 'TS-003');
  // The malformed doc is excluded from the model but retained for repair.
  assert.equal(tree.byId.has('TS-003'), false);
  assert.equal(tree.invalidDocs.get('TS-003')?.kind, 'testSuite');
});

test('(b) repair-update of the malformed doc SUCCEEDS and heals the tree', async () => {
  const { projectRoot, tree, errors } = await scaffoldWedge();
  const res = await updateDocument({
    projectRoot, tree, id: 'TS-003',
    patch: null,
    sets: [{ path: 'status', value: 'draft' }],
    walkErrors: errors,
  });
  assert.equal(res.id, 'TS-003', res.message);
  const after = await walkTree({ projectRoot });
  assert.equal(after.errors.length, 0);
  assert.equal(after.tree.byId.get('TS-003').status, 'draft');
});

test('(c) delete of the malformed doc SUCCEEDS and heals the tree', async () => {
  const { projectRoot, tree, errors } = await scaffoldWedge();
  const res = await deleteDocument({ projectRoot, tree, id: 'TS-003', walkErrors: errors });
  assert.deepEqual(res.deleted, ['TS-003'], res.message);
  assert.equal(await fileExists(join(projectRoot, 'rcf/test-suites/ts-003.json')), false);
  const after = await walkTree({ projectRoot });
  assert.equal(after.errors.length, 0);
});

test('(d) net-new breakage on the already-broken tree is still REFUSED', async () => {
  const { projectRoot, tree, errors } = await scaffoldWedge();
  // Replacing US-101's AC set would leave FBS-001.acIds dangling on
  // AC-101-1 - net-new breakage on top of the pre-existing wedge.
  const res = await updateDocument({
    projectRoot, tree, id: 'US-101',
    patch: { acceptanceCriteria: [{ id: 'AC-101-2', description: 'replaced', testable: true }] },
    sets: [],
    walkErrors: errors,
  });
  assert.equal(res.kind, 'validation');
  assert.equal(res.rule, 'postWriteValidation');
  assert.match(res.message, /FBS-001/);
  // The pre-existing wedge is untouched; nothing was written.
  const after = await walkTree({ projectRoot });
  assert.equal(after.errors.length, 1);
});

test('(d2) a write refused at the doc level still refuses on a broken tree', async () => {
  const { projectRoot, tree, errors } = await scaffoldWedge();
  const res = await updateDocument({
    projectRoot, tree, id: 'REQ-001',
    patch: null,
    sets: [{ path: 'priority', value: 'irresistible' }],
    walkErrors: errors,
  });
  assert.equal(res.kind, 'validation');
});

test('(e) normal-path refusal intact: invalid doc into a VALID tree still refuses', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'rcf-b5-valid-'));
  await initProject({ projectRoot, projectName: 'B5ValidTest' });
  const { tree, errors } = await walkTree({ projectRoot });
  assert.equal(errors.length, 0);
  const res = await updateDocument({
    projectRoot, tree, id: 'REQ-001',
    patch: null,
    sets: [{ path: 'priority', value: 'irresistible' }],
    walkErrors: errors,
  });
  assert.equal(res.kind, 'validation');
});

test('post-write gate closes the inbound-AC hole on VALID trees too', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'rcf-b5-inbound-'));
  await initProject({ projectRoot, projectName: 'B5InboundTest' });
  const { tree, errors } = await walkTree({ projectRoot });
  // FBS-001 references AC-101-1; dropping it from US-101 must refuse
  // even though the US body itself stays schema-valid.
  const res = await updateDocument({
    projectRoot, tree, id: 'US-101',
    patch: { acceptanceCriteria: [{ id: 'AC-101-2', description: 'replaced', testable: true }] },
    sets: [],
    walkErrors: errors,
  });
  assert.equal(res.kind, 'validation');
  assert.equal(res.rule, 'postWriteValidation');
});

test('unrelated writes proceed on the wedged tree (no total lock-in)', async () => {
  const { projectRoot, tree, errors } = await scaffoldWedge();
  const res = await createDocument({
    projectRoot, tree, kind: 'req',
    body: { title: 'Written while wedged' },
    options: { parentId: 'PRD-001' },
    walkErrors: errors,
  });
  assert.equal(res.id, 'REQ-002', res.message);
  const after = await walkTree({ projectRoot });
  // Still exactly the one pre-existing wedge error - nothing new.
  assert.equal(after.errors.length, 1);
  assert.equal(after.errors[0].documentId, 'TS-003');
});

test('id allocation never reuses or overwrites the wedged id', async () => {
  const { projectRoot, tree, errors } = await scaffoldWedge();
  // TS-003 is invalid and absent from tree.testSuites, but its id is
  // occupied: the next TS id must be TS-004, not TS-001/TS-003.
  assert.equal(nextIdForKind(tree, 'ts'), 'TS-004');
  const collision = await createDocument({
    projectRoot, tree, kind: 'ts',
    body: { title: 'T', purpose: 'p', testLevel: 'unit', acIds: ['AC-101-1'] },
    options: { parentId: 'US-101', id: 'TS-003' },
    walkErrors: errors,
  });
  assert.equal(collision.kind, 'usage');
  assert.match(collision.message, /already taken/);
  // The wedged file body is untouched.
  const onDisk = JSON.parse(await readFile(join(projectRoot, 'rcf/test-suites/ts-003.json'), 'utf8'));
  assert.equal(onDisk.status, 'NOT-A-STATUS');
});

test('delete of a parse-broken file succeeds (disk-level wedge variant)', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'rcf-b5-parse-'));
  await initProject({ projectRoot, projectName: 'B5ParseTest' });
  await writeFile(join(projectRoot, 'rcf/test-suites/ts-002.json'), '{truncated', 'utf8');
  const { tree, errors } = await walkTree({ projectRoot });
  assert.equal(errors[0].kind, 'parseFailure');
  const res = await deleteDocument({ projectRoot, tree, id: 'TS-002', walkErrors: errors });
  assert.deepEqual(res.deleted, ['TS-002'], res.message);
  const after = await walkTree({ projectRoot });
  assert.equal(after.errors.length, 0);
});

test('create refuses to overwrite an on-disk file that did not load', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'rcf-b5-overwrite-'));
  await initProject({ projectRoot, projectName: 'B5OverwriteTest' });
  await writeFile(join(projectRoot, 'rcf/test-suites/ts-001.json'), '{truncated', 'utf8');
  const { tree, errors } = await walkTree({ projectRoot });
  const res = await createDocument({
    projectRoot, tree, kind: 'ts',
    body: { title: 'T', purpose: 'p', testLevel: 'unit', acIds: ['AC-101-1'] },
    options: { parentId: 'US-101', id: 'TS-001' },
    walkErrors: errors,
  });
  assert.equal(res.kind, 'usage');
  assert.match(res.message, /already exists on disk/);
});
