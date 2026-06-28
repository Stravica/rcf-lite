import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { initProject } from '../../src/store/init.js';
import { walkTree } from '../../src/store/walker.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

test('walkTree on the live tree returns 54 documents and zero errors (AC-102-1)', async () => {
  const { tree, errors } = await walkTree({ projectRoot: repoRoot });
  assert.deepEqual(errors, [], JSON.stringify(errors, null, 2));
  // 7 REQ + 19 US + 7 TAC + 5 ADR + 12 FBS = 50 children, plus PRD + TAD + BS = 53 docs.
  assert.equal(tree.requirements.length, 7);
  assert.equal(tree.userStories.length, 19);
  assert.equal(tree.tacs.length, 7);
  assert.equal(tree.adrs.length, 5);
  assert.equal(tree.fbsItems.length, 12);
  assert.equal(tree.prd?.prdId, 'PRD-001');
  assert.equal(tree.tad?.tadId, 'TAD-001');
  assert.equal(tree.bs?.bsId, 'BS-001');
});

test('walkTree lists are sorted by id (D15 deterministic output)', async () => {
  const { tree } = await walkTree({ projectRoot: repoRoot });
  const reqIds = tree.requirements.map((r) => r.reqId);
  assert.deepEqual(reqIds, [...reqIds].sort());
  const usIds = tree.userStories.map((u) => u.usId);
  assert.deepEqual(usIds, [...usIds].sort());
  const fbsIds = tree.fbsItems.map((f) => f.fbsId);
  assert.deepEqual(fbsIds, [...fbsIds].sort());
});

test('walkTree reports a missing manifest as a single missingFile error', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-walker-empty-'));
  const { tree, errors } = await walkTree({ projectRoot: root });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].kind, 'missingFile');
  assert.equal(tree.requirements.length, 0);
});

test('walkTree carries on past validation failures and aggregates errors (AC-102-2)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-walker-bad-req-'));
  await initProject({ projectRoot: root });
  // Corrupt the REQ to fail validation.
  await writeFile(
    join(root, 'rcf', 'requirements', 'req-001.json'),
    JSON.stringify({ reqId: 'REQ-001', priority: 'must-do' }),
    'utf8',
  );
  const { tree, errors } = await walkTree({ projectRoot: root });
  assert.ok(errors.some((e) => e.kind === 'validation' && e.documentId === 'REQ-001'));
  // Other docs still load.
  assert.ok(tree.tad);
  assert.ok(tree.bs);
});

test('walkTree reports broken references in the PRD as missingFile (AC-102-3)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-walker-broken-'));
  await initProject({ projectRoot: root });
  // Point PRD at a non-existent REQ.
  const prdPath = join(root, 'rcf', 'prd.json');
  const prd = JSON.parse(await import('node:fs').then((m) => m.readFileSync(prdPath, 'utf8')));
  prd.requirementIds = ['REQ-099'];
  await writeFile(prdPath, JSON.stringify(prd), 'utf8');
  const { tree, errors } = await walkTree({ projectRoot: root });
  const missing = errors.find((e) => e.kind === 'missingFile' && e.documentId === 'REQ-099');
  assert.ok(missing, JSON.stringify(errors));
  assert.ok(tree.brokenIds.has('REQ-099'));
});

test('walkTree reports parseFailure without crashing the walk', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-walker-parse-'));
  await initProject({ projectRoot: root });
  await writeFile(join(root, 'rcf', 'user-stories', 'us-101.json'), '{not json', 'utf8');
  const { tree, errors } = await walkTree({ projectRoot: root });
  assert.ok(errors.some((e) => e.kind === 'parseFailure' && e.documentId === 'US-101'));
  assert.ok(tree.tad);
});

test('walkTree reports unknown FBS dependencies', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-walker-fbs-dep-'));
  await initProject({ projectRoot: root });
  const fbsPath = join(root, 'rcf', 'fbs', 'fbs-001.json');
  const fbs = JSON.parse(await import('node:fs').then((m) => m.readFileSync(fbsPath, 'utf8')));
  fbs.dependencies = ['FBS-999'];
  await writeFile(fbsPath, JSON.stringify(fbs), 'utf8');
  const { errors } = await walkTree({ projectRoot: root });
  assert.ok(errors.some((e) => e.kind === 'missingFile' && e.documentId === 'FBS-999'));
});

test('walkTree byId map covers every loaded document', async () => {
  const { tree } = await walkTree({ projectRoot: repoRoot });
  assert.ok(tree.byId.has('PRD-001'));
  assert.ok(tree.byId.has('REQ-002'));
  assert.ok(tree.byId.has('US-201'));
  assert.ok(tree.byId.has('FBS-003'));
});
