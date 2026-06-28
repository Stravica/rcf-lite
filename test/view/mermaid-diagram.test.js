import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { walkTree } from '../../src/store/index.js';
import {
  allRequirementSubdiagrams,
  masterDiagram,
  requirementSubdiagram,
} from '../../src/view/mermaid-diagram.js';
import { buildTreeModel } from '../../src/view/tree-model.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

test('masterDiagram begins with flowchart TD (AC-201-3)', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const src = masterDiagram(model);
  assert.match(src, /^flowchart TD/);
});

test('masterDiagram contains the chain edges PRD -> REQ -> US (AC-201-1)', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const src = masterDiagram(model);
  assert.match(src, /PRD-001 --> REQ-002/);
  assert.match(src, /REQ-002 --> US-201/);
  assert.match(src, /US-201 --> AC-201-1/);
});

test('masterDiagram contains TAD chain edges to TAC and ADR', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const src = masterDiagram(model);
  assert.match(src, /TAD-001 --> TAC-001/);
  assert.match(src, /TAD-001 --> ADR-001/);
});

test('masterDiagram emits FBS-to-AC dashed delivers edges', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const src = masterDiagram(model);
  assert.match(src, /FBS-003 -\.->\|delivers\| AC-201-1/);
});

test('masterDiagram defines node classes per document type', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const src = masterDiagram(model);
  assert.match(src, /classDef prd/);
  assert.match(src, /classDef req/);
  assert.match(src, /classDef us/);
  assert.match(src, /classDef ac/);
  assert.match(src, /classDef fbs/);
  assert.match(src, /classDef broken/);
});

test('masterDiagram emits click bindings for navigation to doc anchors', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const src = masterDiagram(model);
  assert.match(src, /click US-201 "#doc-us-201";/);
});

test('masterDiagram marks broken ids with the broken class (AC-201-2)', async () => {
  const fakeTree = {
    manifest: { version: '2.0.0' },
    prd: { prdId: 'PRD-001', requirementIds: ['REQ-099'] },
    tad: null,
    bs: null,
    requirements: [],
    userStories: [],
    tacs: [],
    adrs: [],
    fbsItems: [],
    testSuites: [],
    byId: new Map([['PRD-001', { prdId: 'PRD-001', requirementIds: ['REQ-099'] }]]),
    rawById: new Map(),
    brokenIds: new Set(['REQ-099']),
  };
  const model = buildTreeModel({ tree: fakeTree, errors: [] });
  const src = masterDiagram(model);
  assert.match(src, /class REQ-099 broken;/);
});

test('requirementSubdiagram uses flowchart LR orientation', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const req = model.requirements.find((r) => r.reqId === 'REQ-002');
  const src = requirementSubdiagram(model, req);
  assert.match(src, /^flowchart LR/);
});

test('requirementSubdiagram is a focused slice of the master', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const req = model.requirements.find((r) => r.reqId === 'REQ-002');
  const src = requirementSubdiagram(model, req);
  // Contains the REQ's stories and the FBSs that deliver its ACs.
  assert.match(src, /REQ-002 --> US-201/);
  assert.match(src, /US-201 --> AC-201-1/);
  assert.match(src, /FBS-003 -\.->\|delivers\| AC-201-1/);
  // Does NOT contain a different REQ's children.
  assert.doesNotMatch(src, /US-101/);
});

test('allRequirementSubdiagrams returns one diagram per REQ', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const all = allRequirementSubdiagrams(model);
  assert.equal(all.size, model.requirements.length);
  for (const req of model.requirements) {
    assert.ok(all.has(req.reqId));
  }
});

test('masterDiagram is deterministic (D15 sorted ids)', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const one = masterDiagram(model);
  const two = masterDiagram(model);
  assert.equal(one, two);
});
