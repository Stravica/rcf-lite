import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { walkTree } from '#core/store';
import { initProject } from '#core/store/init.js';
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

test('requirementSubdiagram marks a broken node visibly rather than omitting it (AC-201-2)', async () => {
  // Scaffold a real project and break it: a second story under REQ-001
  // claims the same inline AC id as US-101. The walker flags AC-101-1 as
  // broken (globallyUniqueIds); the AC still renders in REQ-001's
  // subdiagram - so the diagram must keep the node AND mark it.
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-diagram-broken-'));
  await initProject({ projectRoot: tmp, projectName: 'BrokenDiagram' });
  const us = JSON.parse(await readFile(join(tmp, 'rcf/user-stories/us-101.json'), 'utf8'));
  const twin = { ...us, usId: 'US-102', title: 'Colliding twin story' };
  await writeFile(join(tmp, 'rcf/user-stories/us-102.json'), `${JSON.stringify(twin, null, 2)}\n`, 'utf8');

  const result = await walkTree({ projectRoot: tmp });
  const model = buildTreeModel(result);
  assert.ok(model.brokenIds.has('AC-101-1'), 'precondition: walker flags the duplicated AC id');
  const req = model.requirements.find((r) => r.reqId === 'REQ-001');
  const src = requirementSubdiagram(model, req);
  // Not omitted silently: the node is still declared...
  assert.match(src, /AC-101-1\[/);
  // ...and visibly marked as broken (the `broken` classDef is the dashed
  // red border treatment in style.css).
  assert.match(src, /class AC-101-1 broken;/);
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
