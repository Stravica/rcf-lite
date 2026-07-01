import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { walkTree } from '../../src/store/index.js';
import {
  allRequirementSubdiagrams,
  overviewDiagram,
  requirementSubdiagram,
} from '../../src/view/mermaid-diagram.js';
import { buildTreeModel } from '../../src/view/tree-model.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

test('overviewDiagram begins with flowchart LR (D3)', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const src = overviewDiagram(model);
  assert.match(src, /^flowchart LR/);
});

test('overviewDiagram wires PRD -> each REQ with a solid edge', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const src = overviewDiagram(model);
  for (const reqId of model.prd?.requirementIds ?? []) {
    assert.match(src, new RegExp(`PRD-001 --> ${reqId}`));
  }
});

test('overviewDiagram wires PRD -.-> TAD and PRD -.-> BS with dashed edges', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const src = overviewDiagram(model);
  assert.match(src, /PRD-001 -\.-> TAD-001/);
  assert.match(src, /PRD-001 -\.-> BS-001/);
});

test('overviewDiagram carries ~10 nodes on the Phase 2 tree (not the full tree)', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const src = overviewDiagram(model);
  // Count node declarations (lines like `  ID[...]`). Should be roughly:
  // 1 PRD + N REQs + 1 TAD + 1 BS.
  const nodeLines = src.split('\n').filter((l) => /^ {2}[A-Z]+-[\w-]+\[/.test(l));
  const expected = 1 + model.requirements.length + (model.tad ? 1 : 0) + (model.bs ? 1 : 0);
  assert.equal(nodeLines.length, expected);
  // Ensure we did NOT emit US or AC or FBS nodes in the overview.
  assert.doesNotMatch(src, /^ {2}US-\d+\[/m);
  assert.doesNotMatch(src, /^ {2}AC-\d+/m);
  assert.doesNotMatch(src, /^ {2}FBS-\d+\[/m);
});

test('overviewDiagram defines node classes per document type', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const src = overviewDiagram(model);
  assert.match(src, /classDef prd/);
  assert.match(src, /classDef req/);
  assert.match(src, /classDef tad/);
  assert.match(src, /classDef bs/);
  assert.match(src, /classDef broken/);
});

test('overviewDiagram emits click bindings to raw doc-id anchors (D7)', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const src = overviewDiagram(model);
  assert.match(src, /click PRD-001 "#PRD-001";/);
  assert.match(src, /click REQ-002 "#REQ-002";/);
  assert.match(src, /click TAD-001 "#TAD-001";/);
});

test('overviewDiagram marks broken ids with the broken class', async () => {
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
  const src = overviewDiagram(model);
  assert.match(src, /class REQ-099 broken;/);
});

test('overviewDiagram is deterministic (D15)', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const one = overviewDiagram(model);
  const two = overviewDiagram(model);
  assert.equal(one, two);
});

test('requirementSubdiagram uses flowchart LR orientation', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const req = model.requirements.find((r) => r.reqId === 'REQ-002');
  const src = requirementSubdiagram(model, req);
  assert.match(src, /^flowchart LR/);
});

test('requirementSubdiagram carries chain edges and delivers back-links', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const req = model.requirements.find((r) => r.reqId === 'REQ-002');
  const src = requirementSubdiagram(model, req);
  assert.match(src, /REQ-002 --> US-201/);
  assert.match(src, /US-201 --> AC-201-1/);
  assert.match(src, /AC-201-1 -\.->\|delivered by\| FBS-003/);
  // Does NOT contain a different REQ's children.
  assert.doesNotMatch(src, /US-101/);
});

test('requirementSubdiagram emits click bindings for every node (D7)', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const req = model.requirements.find((r) => r.reqId === 'REQ-002');
  const src = requirementSubdiagram(model, req);
  assert.match(src, /click REQ-002 "#REQ-002";/);
  assert.match(src, /click US-201 "#US-201";/);
  assert.match(src, /click AC-201-1 "#AC-201-1";/);
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
