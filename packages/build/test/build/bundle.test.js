// Unit tests for pure bundle assembly (Phase 6 §D3, §D11, §3.4).
// Hand-built TreeModel-shaped fixtures, same pattern as test/query.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { assembleBundle } from '../../src/build/bundle.js';

/**
 * Build a TreeModel-shaped fixture with the maps bundle assembly
 * consumes: byId / kindById / parentByChild / dependentsByFbsId /
 * tsByAcId / tcsByAcId plus the doc arrays and roots.
 */
function makeTree({
  fbsItems = [], userStories = [], requirements = [], tacs = [], adrs = [],
  testSuites = [], bs = null, prd = null, tad = null,
} = {}) {
  const byId = new Map();
  const kindById = new Map();
  const parentByChild = new Map();
  const dependentsByFbsId = new Map();
  const tsByAcId = new Map();
  const tcsByAcId = new Map();
  const push = (map, key, value) => map.set(key, [...(map.get(key) ?? []), value]);

  for (const f of fbsItems) { byId.set(f.fbsId, f); kindById.set(f.fbsId, 'fbs'); }
  for (const f of fbsItems) {
    for (const depId of f.dependsOnFbsIds ?? []) push(dependentsByFbsId, depId, f.fbsId);
  }
  for (const us of userStories) {
    byId.set(us.usId, us);
    kindById.set(us.usId, 'userStory');
    for (const ac of us.acceptanceCriteria ?? []) parentByChild.set(ac.id, us.usId);
  }
  for (const r of requirements) { byId.set(r.reqId, r); kindById.set(r.reqId, 'req'); }
  for (const t of tacs) { byId.set(t.tacId, t); kindById.set(t.tacId, 'tac'); }
  for (const a of adrs) { byId.set(a.adrId, a); kindById.set(a.adrId, 'adr'); }
  for (const ts of testSuites) {
    byId.set(ts.id, ts);
    kindById.set(ts.id, 'testSuite');
    for (const acId of ts.acIds ?? []) push(tsByAcId, acId, ts.id);
    for (const tc of ts.testCases ?? []) push(tcsByAcId, tc.acId, { tsId: ts.id, tcId: tc.id });
  }
  return {
    fbsItems, userStories, requirements, tacs, adrs, testSuites,
    bs, prd, tad, byId, kindById, parentByChild, dependentsByFbsId, tsByAcId, tcsByAcId,
  };
}

function baseFixture(overrides = {}) {
  return makeTree({
    fbsItems: [
      {
        fbsId: 'FBS-001', title: 'Store', buildOrder: 1, executionStatus: 'complete',
        summary: 'Store summary', acIds: [], dependsOnFbsIds: [],
      },
      {
        fbsId: 'FBS-002', title: 'Verbs', buildOrder: 2, executionStatus: 'notStarted',
        summary: 'Verb summary', approach: 'The approach', deliverables: ['d1', 'd2'],
        notes: 'The notes', estimatedSize: 'small', estimatedHours: 3, riskLevel: 'low',
        domain: 'crud', updatedAt: '2026-01-02T00:00:00Z',
        acIds: ['AC-202-1', 'AC-101-1', 'AC-202-2'],
        dependsOnFbsIds: ['FBS-001'],
      },
      {
        fbsId: 'FBS-003', title: 'Later', buildOrder: 3, executionStatus: 'notStarted',
        summary: 'Later summary', acIds: [], dependsOnFbsIds: ['FBS-002'],
      },
    ],
    userStories: [
      {
        usId: 'US-101', reqId: 'REQ-001', title: 'First story', asA: 'owner',
        iWant: 'a thing', soThat: 'value', status: 'draft',
        acceptanceCriteria: [
          { id: 'AC-101-1', description: 'First AC', given: 'g1', when: 'w1', then: 't1', testable: true },
        ],
      },
      {
        usId: 'US-202', reqId: 'REQ-002', title: 'Second story', asA: 'agent',
        iWant: 'another', soThat: 'more value', status: 'approved',
        acceptanceCriteria: [
          { id: 'AC-202-1', description: 'Second AC', testable: true },
          { id: 'AC-202-2', description: 'Third AC', testable: false },
        ],
      },
    ],
    requirements: [
      {
        reqId: 'REQ-001', title: 'Req one', description: 'Req one desc',
        category: 'functional', priority: 'must', rationale: 'Because',
      },
      { reqId: 'REQ-002', title: 'Req two', description: 'Req two desc', category: 'functional', priority: 'should' },
    ],
    bs: { bsId: 'BS-001', title: 'Plan', buildPhilosophy: 'Philosophy', generationStrategy: 'dependencyFirst' },
    prd: { prdId: 'PRD-001', productName: 'Product', executiveSummary: 'Exec summary' },
    tad: { tadId: 'TAD-001', systemOverview: 'Overview text' },
    ...overrides,
  });
}

test('unknown id and non-FBS id return null', () => {
  const tree = baseFixture();
  assert.equal(assembleBundle(tree, { fbsId: 'FBS-999' }), null);
  assert.equal(assembleBundle(tree, { fbsId: 'US-101' }), null);
});

test('fbs block picks the D14 fields; absent optionals are omitted', () => {
  const tree = baseFixture();
  const full = assembleBundle(tree, { fbsId: 'FBS-002' });
  assert.deepEqual(full.fbs, {
    fbsId: 'FBS-002', title: 'Verbs', buildOrder: 2, executionStatus: 'notStarted',
    summary: 'Verb summary', approach: 'The approach', deliverables: ['d1', 'd2'],
    notes: 'The notes', estimatedSize: 'small', estimatedHours: 3, riskLevel: 'low',
    domain: 'crud', updatedAt: '2026-01-02T00:00:00Z',
  });
  const sparse = assembleBundle(tree, { fbsId: 'FBS-001' });
  assert.equal('approach' in sparse.fbs, false);
  assert.equal('estimatedSize' in sparse.fbs, false);
});

test('queue position and total reflect the buildOrder total order', () => {
  const bundle = assembleBundle(baseFixture(), { fbsId: 'FBS-002' });
  assert.deepEqual(bundle.queue, { position: 2, total: 3 });
});

test('bs and prd identity blocks carried; null when roots absent', () => {
  const bundle = assembleBundle(baseFixture(), { fbsId: 'FBS-002' });
  assert.deepEqual(bundle.bs, {
    bsId: 'BS-001', title: 'Plan', buildPhilosophy: 'Philosophy', generationStrategy: 'dependencyFirst',
  });
  assert.deepEqual(bundle.prd, { prdId: 'PRD-001', productName: 'Product' });
  const bare = assembleBundle(baseFixture({ bs: null, prd: null }), { fbsId: 'FBS-002' });
  assert.equal(bare.bs, null);
  assert.equal(bare.prd, null);
});

test('dependencies resolve to {fbsId, title, executionStatus}; dependents listed', () => {
  const bundle = assembleBundle(baseFixture(), { fbsId: 'FBS-002' });
  assert.deepEqual(bundle.dependencies, [
    { fbsId: 'FBS-001', title: 'Store', executionStatus: 'complete' },
  ]);
  assert.deepEqual(bundle.dependents, ['FBS-003']);
});

test('blockedBy empty when dependencies satisfied, populated when not', () => {
  const tree = baseFixture();
  assert.deepEqual(assembleBundle(tree, { fbsId: 'FBS-002' }).blockedBy, []);
  assert.deepEqual(assembleBundle(tree, { fbsId: 'FBS-003' }).blockedBy, ['FBS-002']);
});

test('US groups order by first appearance in authored acIds; ACs keep authored order', () => {
  const bundle = assembleBundle(baseFixture(), { fbsId: 'FBS-002' });
  // Authored acIds: AC-202-1 (US-202), AC-101-1 (US-101), AC-202-2 (US-202).
  assert.deepEqual(bundle.userStories.map((u) => u.usId), ['US-202', 'US-101']);
  assert.deepEqual(bundle.acceptanceCriteria.map((a) => a.id), ['AC-202-1', 'AC-202-2', 'AC-101-1']);
});

test('each AC carries usId + reqId ancestry and its own fields', () => {
  const bundle = assembleBundle(baseFixture(), { fbsId: 'FBS-002' });
  const ac = bundle.acceptanceCriteria.find((a) => a.id === 'AC-101-1');
  assert.deepEqual(ac, {
    id: 'AC-101-1', description: 'First AC', given: 'g1', when: 'w1', then: 't1',
    testable: true, usId: 'US-101', reqId: 'REQ-001',
  });
});

test('requirements deduplicate in group order; rationale only when present', () => {
  const bundle = assembleBundle(baseFixture(), { fbsId: 'FBS-002' });
  assert.deepEqual(bundle.requirements.map((r) => r.reqId), ['REQ-002', 'REQ-001']);
  assert.equal('rationale' in bundle.requirements[0], false);
  assert.equal(bundle.requirements[1].rationale, 'Because');
});

test('context omitted entirely when contextRequirements absent (D11)', () => {
  const bundle = assembleBundle(baseFixture(), { fbsId: 'FBS-002' });
  assert.equal('context' in bundle, false);
});

test('tacIds / adrIds inline the referenced documents in authored order', () => {
  const tree = baseFixture();
  tree.byId.get('FBS-002').contextRequirements = { tacIds: ['TAC-002', 'TAC-001'], adrIds: ['ADR-001'] };
  tree.tacs.push(
    { tacId: 'TAC-001', name: 'One', purpose: 'P1', responsibilities: ['r1'], tradeoffs: 'T1' },
    { tacId: 'TAC-002', name: 'Two', purpose: 'P2' },
  );
  tree.adrs.push({
    adrId: 'ADR-001', title: 'Decision', status: 'accepted', context: 'C',
    decision: 'D', consequences: 'Q',
    alternativesConsidered: [{ name: 'Alt', summary: 'S', reasonNotChosen: 'R' }],
  });
  for (const t of tree.tacs) { tree.byId.set(t.tacId, t); tree.kindById.set(t.tacId, 'tac'); }
  for (const a of tree.adrs) { tree.byId.set(a.adrId, a); tree.kindById.set(a.adrId, 'adr'); }
  const bundle = assembleBundle(tree, { fbsId: 'FBS-002' });
  assert.deepEqual(bundle.context.tacs.map((t) => t.tacId), ['TAC-002', 'TAC-001']);
  assert.equal(bundle.context.tacs[1].tradeoffs, 'T1');
  assert.equal('tradeoffs' in bundle.context.tacs[0], false);
  assert.equal(bundle.context.adrs[0].adrId, 'ADR-001');
  assert.equal(bundle.context.adrs[0].alternativesConsidered[0].name, 'Alt');
});

test('tadSections / prdSections resolve top-level properties; unresolved names pass through with no error', () => {
  const tree = baseFixture();
  tree.byId.get('FBS-002').contextRequirements = {
    tadSections: ['systemOverview', 'noSuchSection'],
    prdSections: ['executiveSummary', 'alsoMissing'],
  };
  const bundle = assembleBundle(tree, { fbsId: 'FBS-002' });
  assert.deepEqual(bundle.context.tadSections, { systemOverview: 'Overview text' });
  assert.deepEqual(bundle.context.prdSections, { executiveSummary: 'Exec summary' });
  assert.deepEqual(bundle.context.unresolvedSections, ['noSuchSection', 'alsoMissing']);
});

test('passThrough lists carried verbatim; absent lists default to empty', () => {
  const tree = baseFixture();
  tree.byId.get('FBS-002').contextRequirements = {
    existingModules: ['src/store/walker.js'],
    externalDocs: ['https://example.com/doc'],
  };
  const bundle = assembleBundle(tree, { fbsId: 'FBS-002' });
  assert.deepEqual(bundle.context.passThrough, {
    existingModules: ['src/store/walker.js'],
    schemas: [],
    externalDocs: ['https://example.com/doc'],
    other: [],
  });
});

test('test surface: covered flag, suites and case detail per AC; uncovered flagged', () => {
  const tree = baseFixture({
    testSuites: [{
      id: 'TS-001', usId: 'US-101', acIds: ['AC-101-1'],
      testCases: [{
        id: 'TC-001-happy', acId: 'AC-101-1', description: 'Happy path',
        status: 'passing', testPointer: 'test/x.test.js::happy',
      }],
    }],
  });
  const bundle = assembleBundle(tree, { fbsId: 'FBS-002' });
  const covered = bundle.tests.find((t) => t.acId === 'AC-101-1');
  assert.deepEqual(covered, {
    acId: 'AC-101-1',
    covered: true,
    suites: ['TS-001'],
    cases: [{
      tcId: 'TC-001-happy', tsId: 'TS-001', description: 'Happy path',
      status: 'passing', testPointer: 'test/x.test.js::happy',
    }],
  });
  const uncovered = bundle.tests.find((t) => t.acId === 'AC-202-1');
  assert.deepEqual(uncovered, { acId: 'AC-202-1', covered: false, suites: [], cases: [] });
});

test('completionContract carries the three mark commands for the item', () => {
  const bundle = assembleBundle(baseFixture(), { fbsId: 'FBS-002' });
  assert.deepEqual(bundle.completionContract, {
    markInProgress: 'rcf build FBS-002 --mark inProgress',
    markComplete: 'rcf build FBS-002 --mark complete',
    markVerified: 'rcf build FBS-002 --mark verified',
  });
});
