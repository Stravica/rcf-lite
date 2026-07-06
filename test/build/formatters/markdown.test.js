// Formatter tests for the markdown emitter (Phase 6 §D4, §3.4):
// bundle headings in D3 order, queue table shape, BLOCKED block,
// no U+2014, byte-stable repeat invocation.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatMarkdown } from '../../../src/build/formatters/markdown.js';

function sampleBundle(overrides = {}) {
  return {
    fbs: {
      fbsId: 'FBS-002', title: 'Verbs', buildOrder: 2, executionStatus: 'notStarted',
      summary: 'Verb summary', updatedAt: '2026-01-02T00:00:00Z',
    },
    queue: { position: 2, total: 3 },
    bs: { bsId: 'BS-001', title: 'Plan', buildPhilosophy: 'Philosophy', generationStrategy: 'dependencyFirst' },
    prd: { prdId: 'PRD-001', productName: 'Product' },
    blockedBy: [],
    dependencies: [{ fbsId: 'FBS-001', title: 'Store', executionStatus: 'complete' }],
    dependents: ['FBS-003'],
    acceptanceCriteria: [
      { id: 'AC-101-1', description: 'First AC', given: 'g', when: 'w', then: 't', testable: true, usId: 'US-101', reqId: 'REQ-001' },
    ],
    userStories: [
      { usId: 'US-101', title: 'First story', asA: 'owner', iWant: 'a thing', soThat: 'value', status: 'draft' },
    ],
    requirements: [
      { reqId: 'REQ-001', title: 'Req one', description: 'Req desc', category: 'functional', priority: 'must' },
    ],
    context: {
      tacs: [{ tacId: 'TAC-001', name: 'One', purpose: 'P1' }],
      adrs: [],
      tadSections: { systemOverview: 'Overview text' },
      prdSections: {},
      unresolvedSections: ['ghostSection'],
      passThrough: { existingModules: [], schemas: ['x.schema.json'], externalDocs: [], other: [] },
    },
    tests: [{ acId: 'AC-101-1', covered: false, suites: [], cases: [] }],
    completionContract: {
      markInProgress: 'rcf build FBS-002 --mark inProgress',
      markComplete: 'rcf build FBS-002 --mark complete',
      markVerified: 'rcf build FBS-002 --mark verified',
    },
    ...overrides,
  };
}

function sampleQueue() {
  return {
    bs: { bsId: 'BS-001', title: 'Plan', generationStrategy: 'dependencyFirst' },
    totals: { items: 3, notStarted: 2, inProgress: 0, complete: 1, verified: 0, actionable: 1, blocked: 1 },
    nextActionable: 'FBS-002',
    items: [
      { fbsId: 'FBS-001', buildOrder: 1, title: 'Store', executionStatus: 'complete', dependsOnFbsIds: [], state: 'complete', blockedBy: [] },
      { fbsId: 'FBS-002', buildOrder: 2, title: 'Verbs', executionStatus: 'notStarted', dependsOnFbsIds: [], state: 'actionable', blockedBy: [] },
      { fbsId: 'FBS-003', buildOrder: 3, title: 'Cyclic', executionStatus: 'notStarted', dependsOnFbsIds: ['FBS-003'], state: 'blocked', blockedBy: ['FBS-003'], cycle: true },
    ],
  };
}

test('bundle renders the seven D3 sections as headings, in order', () => {
  const md = formatMarkdown(sampleBundle(), 'bundle');
  const headings = md.split('\n').filter((l) => l.startsWith('## '));
  assert.deepEqual(headings, [
    '## 1. Header',
    '## 2. Queue and dependency context',
    '## 3. The work',
    '## 4. Acceptance criteria',
    '## 5. Architectural context',
    '## 6. Existing test surface',
    '## 7. Build-cycle runbook',
  ]);
});

test('section 5 is omitted without renumbering when context is absent', () => {
  const bundle = sampleBundle();
  delete bundle.context;
  const md = formatMarkdown(bundle, 'bundle');
  assert.equal(md.includes('## 5. Architectural context'), false);
  assert.equal(md.includes('## 6. Existing test surface'), true);
  assert.equal(md.includes('## 7. Build-cycle runbook'), true);
});

test('runbook renders all five stages with referee commands and the mark loop', () => {
  const md = formatMarkdown(sampleBundle(), 'bundle');
  for (const stage of ['Stage 1 - Define', 'Stage 2 - Build', 'Stage 3 - Review', 'Stage 4 - Test', 'Stage 5 - Finalise']) {
    assert.equal(md.includes(`### ${stage}`), true, stage);
  }
  assert.equal(md.includes('rcf build FBS-002 --mark inProgress'), true);
  assert.equal(md.includes('rcf validate'), true);
  assert.equal(md.includes('rcf coverage --strict'), true);
  assert.equal(md.includes('rcf build FBS-002 --mark complete'), true);
  assert.equal(md.includes('rcf build FBS-002 --mark verified'), true);
  // Each-stage-commits discipline is part of the printed contract (D3-A).
  assert.match(md, /Every stage ends in a commit/);
});

test('BLOCKED warning block renders at the top of section 2 when blockedBy is non-empty', () => {
  const bundle = sampleBundle({
    blockedBy: ['FBS-001'],
    dependencies: [{ fbsId: 'FBS-001', title: 'Store', executionStatus: 'notStarted' }],
  });
  const md = formatMarkdown(bundle, 'bundle');
  const section2 = md.split('## 2. Queue and dependency context')[1];
  assert.match(section2, /^\n\n> \*\*BLOCKED\*\*: unsatisfied dependencies - FBS-001 \(notStarted\)\./);
  // Unblocked bundle has no BLOCKED block.
  assert.equal(formatMarkdown(sampleBundle(), 'bundle').includes('BLOCKED'), false);
});

test('queue table renders one row per item with the blocked (cycle) label', () => {
  const md = formatMarkdown(sampleQueue(), 'queue');
  assert.match(md, /\| order \| id \| title \| status \| state \| blocked by \|/);
  assert.match(md, /\| 1 \| FBS-001 \| Store \| complete \| complete \|  \|/);
  assert.match(md, /\| 3 \| FBS-003 \| Cyclic \| notStarted \| blocked \(cycle\) \| FBS-003 \|/);
  assert.match(md, /Next actionable: FBS-002/);
});

test('next mode with nothing actionable distinguishes done from stuck', () => {
  const done = formatMarkdown({ queueEmpty: true, totals: {}, blocked: [], inProgress: [] }, 'next');
  assert.match(done, /Queue complete: every item is complete or verified\./);
  const stuck = formatMarkdown(
    { queueEmpty: false, totals: {}, blocked: ['FBS-003'], inProgress: ['FBS-002'] },
    'next',
  );
  assert.match(stuck, /Blocked: FBS-003/);
  assert.match(stuck, /In progress: FBS-002/);
});

test('unresolved sections and pass-through lists render; empty pass-through lists are omitted', () => {
  const md = formatMarkdown(sampleBundle(), 'bundle');
  assert.match(md, /Warning - unresolved sections .*: ghostSection/);
  assert.match(md, /- Schemas: x\.schema\.json/);
  assert.equal(md.includes('- Existing modules:'), false);
});

test('no U+2014 em-dash in any emitted output (D17)', () => {
  const outputs = [
    formatMarkdown(sampleBundle(), 'bundle'),
    formatMarkdown(sampleQueue(), 'queue'),
    formatMarkdown({ queueEmpty: true, totals: {}, blocked: [], inProgress: [] }, 'next'),
  ];
  for (const out of outputs) assert.equal(out.includes('\u2014'), false);
});

test('repeat invocation over the same result is byte-identical (D10)', () => {
  const bundle = sampleBundle();
  assert.equal(formatMarkdown(bundle, 'bundle'), formatMarkdown(bundle, 'bundle'));
  const queue = sampleQueue();
  assert.equal(formatMarkdown(queue, 'queue'), formatMarkdown(queue, 'queue'));
});
