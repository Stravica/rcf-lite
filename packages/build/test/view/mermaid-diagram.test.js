import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { walkTree } from '../../src/store/index.js';
import {
  allRequirementSubdiagrams,
  requirementSubdiagram,
} from '../../src/view/mermaid-diagram.js';
import { buildTreeModel } from '../../src/view/tree-model.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

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

test('requirementSubdiagram palette carries distinct ts / tc classDefs', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const req = model.requirements.find((r) => r.reqId === 'REQ-002');
  const src = requirementSubdiagram(model, req);
  // The classDef block is appended to every diagram; ts / tc must be
  // present with their own fills, not aliases of us / ac (palette kept
  // in sync with src/query/formatters/mermaid.js).
  assert.match(src, /classDef ts fill:#99f6e4/);
  assert.match(src, /classDef tc fill:#d9f99d/);
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
