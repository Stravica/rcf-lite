import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { walkTree } from '../../src/store/index.js';
import { buildTreeModel, listAllDocumentIds } from '../../src/view/tree-model.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

test('buildTreeModel produces storiesByReqId for the live tree', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const req2Stories = model.storiesByReqId.get('REQ-002');
  assert.ok(req2Stories);
  assert.equal(req2Stories.length, 3);
  assert.deepEqual(req2Stories.map((u) => u.usId), ['US-201', 'US-202', 'US-203']);
});

test('buildTreeModel produces fbsByAcId pointing to delivering FBSs', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const list = model.fbsByAcId.get('AC-201-1');
  assert.ok(list);
  assert.equal(list[0].fbsId, 'FBS-003');
});

test('buildTreeModel resolves usByAcId', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const us = model.usByAcId.get('AC-201-1');
  assert.equal(us?.usId, 'US-201');
});

test('listAllDocumentIds covers every loaded id in stable order', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const ids = listAllDocumentIds(model);
  assert.ok(ids.includes('PRD-001'));
  assert.ok(ids.includes('REQ-002'));
  assert.ok(ids.includes('US-201'));
  assert.ok(ids.includes('TAD-001'));
  assert.ok(ids.includes('TAC-001'));
  assert.ok(ids.includes('ADR-001'));
  assert.ok(ids.includes('BS-001'));
  assert.ok(ids.includes('FBS-003'));
});

test('buildTreeModel records brokenIds and errorsById for broken trees', async () => {
  const fakeTree = {
    manifest: { version: '2.0.0' },
    prd: null,
    tad: null,
    bs: null,
    requirements: [],
    userStories: [],
    tacs: [],
    adrs: [],
    fbsItems: [],
    testSuites: [],
    byId: new Map(),
    rawById: new Map(),
    brokenIds: new Set(['REQ-099']),
    parentByChild: new Map(),
    childrenByParent: new Map(),
    fbsByAcId: new Map(),
    dependentsByFbsId: new Map(),
    tsByAcId: new Map(),
    tcsByAcId: new Map(),
    usByTacId: new Map(),
  };
  const errors = [{ kind: 'brokenReference', message: 'gone', documentId: 'REQ-099' }];
  const model = buildTreeModel({ tree: fakeTree, errors });
  assert.ok(model.brokenIds.has('REQ-099'));
  assert.ok(model.errorsById.get('REQ-099'));
});

test('buildTreeModel exposes the walker-computed parentByChild and childrenByParent maps (D7)', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  // Every REQ hangs off PRD-001 in the dogfood tree.
  assert.equal(model.parentByChild.get('REQ-001'), 'PRD-001');
  const prdChildren = model.childrenByParent.get('PRD-001') ?? [];
  assert.ok(prdChildren.includes('REQ-001'));
  assert.ok(prdChildren.includes('REQ-007'));
});

test('buildTreeModel passes the walker-computed dependentsByFbsId map through (D4)', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  // The dogfood tree carries FBS-002 depending on FBS-001; the dependents
  // inversion maps FBS-001 -> [FBS-002, ...].
  const deps = model.dependentsByFbsId.get('FBS-001') ?? [];
  assert.ok(deps.includes('FBS-002'), `expected FBS-002 among dependents of FBS-001, got ${deps.join(',')}`);
});

test('buildTreeModel exposes empty tsByAcId / tcsByAcId when no TS files exist', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  assert.equal(model.tsByAcId.size, 0);
  assert.equal(model.tcsByAcId.size, 0);
});
