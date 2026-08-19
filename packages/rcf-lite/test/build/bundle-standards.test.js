// Bundle-assembly tests for 0.4.4 selective retrieval. Covers AC-1004-1
// (agentic selection populates context.standardIds), AC-1004-2 (operator
// override honoured verbatim) and AC-1004-3 (no-standards case never
// blocks).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assembleBundle } from '../../src/build/bundle.js';

function makeTree({ fbs, manifest = {}, us, req } = {}) {
  const byId = new Map();
  const kindById = new Map();
  const parentByChild = new Map();
  const dependentsByFbsId = new Map();
  const tsByAcId = new Map();
  const tcsByAcId = new Map();
  byId.set(fbs.fbsId, fbs);
  kindById.set(fbs.fbsId, 'fbs');
  if (us) {
    byId.set(us.usId, us);
    kindById.set(us.usId, 'userStory');
    for (const ac of us.acceptanceCriteria ?? []) parentByChild.set(ac.id, us.usId);
  }
  if (req) { byId.set(req.reqId, req); kindById.set(req.reqId, 'req'); }
  return {
    fbsItems: [fbs], userStories: us ? [us] : [], requirements: req ? [req] : [],
    tacs: [], adrs: [], testSuites: [],
    bs: null, prd: null, tad: null,
    manifest,
    byId, kindById, parentByChild, dependentsByFbsId, tsByAcId, tcsByAcId,
  };
}

const req = { reqId: 'REQ-001', title: 'r', description: 'd', category: 'functional', priority: 'must' };
const us = {
  usId: 'US-101', reqId: 'REQ-001', title: 't', asA: 'a', iWant: 'i', soThat: 's', status: 'draft',
  acceptanceCriteria: [{ id: 'AC-101-1', description: 'ac', testable: true }],
};

test('bundle: agentic selection picks matching standards from manifest.standards[] (AC-1004-1)', () => {
  const fbs = {
    fbsId: 'FBS-014', title: 'security logging',
    summary: 'add security logging on POST /users', acIds: ['AC-101-1'], dependsOnFbsIds: [],
    contextRequirements: {}, // present but no operator-authored standardIds
  };
  const manifest = {
    standards: [
      { id: 'std-security-baseline', slug: 'security-baseline', tags: ['security', 'logging'], testsProvidedBy: 'agent', provenance: 'corporate', sourcePath: 'x' },
      { id: 'std-wsd-naming', slug: 'wsd-naming', tags: ['naming'], testsProvidedBy: 'agent', provenance: 'corporate', sourcePath: 'y' },
    ],
  };
  const tree = makeTree({ fbs, us, req, manifest });
  const bundle = assembleBundle(tree, { fbsId: 'FBS-014' });
  assert.ok(bundle.context, 'context should be present');
  assert.deepEqual(bundle.context.standardIds, ['security-baseline']);
  assert.equal(bundle.context.standardsSource, 'agenticSelection');
  assert.equal(bundle.context.standards.length, 1);
  assert.equal(bundle.context.standards[0].slug, 'security-baseline');
});

test('bundle: operator-authored contextRequirements.standardIds overrides the agentic selection (AC-1004-2)', () => {
  const fbs = {
    fbsId: 'FBS-014', title: 'security logging',
    summary: 'add security logging on POST /users', acIds: ['AC-101-1'], dependsOnFbsIds: [],
    contextRequirements: { standardIds: ['wsd-naming'] },
  };
  const manifest = {
    standards: [
      { id: 'std-security-baseline', slug: 'security-baseline', tags: ['security', 'logging'], testsProvidedBy: 'agent', provenance: 'corporate', sourcePath: 'x' },
      { id: 'std-wsd-naming', slug: 'wsd-naming', tags: ['naming'], testsProvidedBy: 'agent', provenance: 'corporate', sourcePath: 'y' },
    ],
  };
  const tree = makeTree({ fbs, us, req, manifest });
  const bundle = assembleBundle(tree, { fbsId: 'FBS-014' });
  assert.deepEqual(bundle.context.standardIds, ['wsd-naming']);
  assert.equal(bundle.context.standardsSource, 'operatorOverride');
  assert.equal(bundle.context.standards[0].slug, 'wsd-naming');
});

test('bundle: empty selection is legitimate and never blocks (AC-1004-3)', () => {
  const fbs = {
    fbsId: 'FBS-014', title: 'unrelated', summary: 'refactor', acIds: ['AC-101-1'], dependsOnFbsIds: [],
    contextRequirements: {},
  };
  const manifest = {
    standards: [
      { id: 'std-security-baseline', slug: 'security-baseline', tags: ['security'], testsProvidedBy: 'agent', provenance: 'corporate', sourcePath: 'x' },
    ],
  };
  const tree = makeTree({ fbs, us, req, manifest });
  const bundle = assembleBundle(tree, { fbsId: 'FBS-014' });
  assert.deepEqual(bundle.context.standardIds, []);
  assert.deepEqual(bundle.context.standards, []);
});

test('bundle: no manifest.standards[] and no contextRequirements — bundle assembles without a context.standardIds field or with an empty one', () => {
  const fbs = {
    fbsId: 'FBS-014', title: 'anything', summary: 'anything', acIds: ['AC-101-1'], dependsOnFbsIds: [],
  };
  const tree = makeTree({ fbs, us, req, manifest: {} });
  const bundle = assembleBundle(tree, { fbsId: 'FBS-014' });
  // Absent-contextRequirements + empty manifest.standards: context is omitted entirely.
  assert.equal(bundle.context, undefined);
});

test('bundle: manifest.standards[] present with no contextRequirements block still runs the selector', () => {
  const fbs = {
    fbsId: 'FBS-014', title: 'security posture check',
    summary: 'apply security baselines', acIds: ['AC-101-1'], dependsOnFbsIds: [],
  };
  const manifest = {
    standards: [
      { id: 'std-security-baseline', slug: 'security-baseline', tags: ['security'], testsProvidedBy: 'agent', provenance: 'corporate', sourcePath: 'x' },
    ],
  };
  const tree = makeTree({ fbs, us, req, manifest });
  const bundle = assembleBundle(tree, { fbsId: 'FBS-014' });
  assert.ok(bundle.context, 'context should synthesise when the manifest carries standards[]');
  assert.deepEqual(bundle.context.standardIds, ['security-baseline']);
});
