// Per-document renderer tests. Each asserts on structural elements (anchors,
// curated key fields, raw JSON disclosure) rather than full HTML snapshots
// (per spec §9.5).
//
// Phase 3.2 anchor convention: raw doc-id (e.g. "REQ-001"), not the old
// `doc-req-001` form. See helpers.js `anchorIdFor`.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderAdr } from '../../../src/view/doc-renderers/adr.js';
import { renderBuildSequence } from '../../../src/view/doc-renderers/build-sequence.js';
import { renderFbs } from '../../../src/view/doc-renderers/fbs.js';
import { renderPrd } from '../../../src/view/doc-renderers/prd.js';
import { renderReq } from '../../../src/view/doc-renderers/req.js';
import { renderTac } from '../../../src/view/doc-renderers/tac.js';
import { renderTad } from '../../../src/view/doc-renderers/tad.js';
import { renderTestSuite } from '../../../src/view/doc-renderers/test-suite.js';
import { renderUserStory } from '../../../src/view/doc-renderers/user-story.js';

test('renderPrd emits a doc-prd article with the prd anchor and computed child links (D15)', () => {
  const html = renderPrd(
    {
      prdId: 'PRD-001',
      productName: 'Acme',
      executiveSummary: 'one paragraph',
      problemStatement: 'p',
      objectives: ['o'],
    },
    { raw: '{}', requirementIds: ['REQ-001', 'REQ-002'] },
  );
  assert.match(html, /id="PRD-001"/);
  assert.match(html, /doc-prd/);
  assert.match(html, /Acme/);
  assert.match(html, /href="#REQ-001"/);
  assert.match(html, /href="#REQ-002"/);
  assert.match(html, /Show raw JSON/);
});

test('renderReq embeds subdiagram when supplied and does not list user stories inline', () => {
  const html = renderReq(
    {
      reqId: 'REQ-002',
      title: 'Visual review surface',
      description: 'desc',
      category: 'functional',
      domain: 'view',
      priority: 'must',
    },
    {
      raw: '{}',
      subdiagram: 'flowchart LR\n  REQ-002 --> US-201',
    },
  );
  assert.match(html, /id="REQ-002"/);
  assert.match(html, /<pre class="mermaid">/);
  assert.match(html, /flowchart LR/);
  // User stories are NOT listed by the REQ renderer in Phase 3.2 - they are
  // nested as separate `<details>` in html-page.
  assert.doesNotMatch(html, /User stories/);
});

test('renderUserStory renders Given / When / Then per AC as list items with FBS coverage', () => {
  const fbsByAcId = new Map([['AC-201-1', [{ fbsId: 'FBS-003' }]]]);
  const html = renderUserStory(
    {
      usId: 'US-201',
      title: 'Render',
      asA: 'owner',
      iWant: 'see',
      soThat: 'review',
      reqId: 'REQ-002',
      acceptanceCriteria: [
        { id: 'AC-201-1', description: 'd', given: 'g', when: 'w', then: 't', testable: true },
      ],
    },
    { raw: '{}', fbsByAcId },
  );
  assert.match(html, /id="US-201"/);
  assert.match(html, /id="AC-201-1"/);
  assert.match(html, /class="ac-item"/);
  assert.match(html, /Given/);
  assert.match(html, /When/);
  assert.match(html, /Then/);
  assert.match(html, /Covered by/);
  assert.match(html, /href="#FBS-003"/);
  assert.match(html, /href="#REQ-002"/);
});

test('renderUserStory shows a not-yet-delivered note when no FBS covers an AC', () => {
  const html = renderUserStory(
    {
      usId: 'US-999',
      title: 'T',
      asA: 'a',
      iWant: 'i',
      soThat: 's',
      reqId: 'REQ-999',
      acceptanceCriteria: [{ id: 'AC-999-1', description: 'd', testable: false }],
    },
    { raw: '{}', fbsByAcId: new Map() },
  );
  assert.match(html, /not yet delivered by any FBS/);
});

test('renderTad iterates architecturePrinciples and lists computed TAC / ADR children (D15)', () => {
  const html = renderTad(
    {
      tadId: 'TAD-001',
      systemOverview: {
        executiveSummary: 'x',
        systemPurpose: 'y',
        architecturalApproach: 'z',
        keyCapabilities: ['cap1'],
      },
      architecturePrinciples: [
        { name: 'P1', description: 'd1', rationale: 'r1' },
        { name: 'P2', description: 'd2', rationale: 'r2' },
      ],
    },
    { raw: '{}', componentIds: ['TAC-001', 'TAC-002'], architecturalDecisionIds: ['ADR-001'] },
  );
  assert.match(html, /id="TAD-001"/);
  assert.match(html, /P1/);
  assert.match(html, /P2/);
  assert.match(html, /href="#TAC-001"/);
  assert.match(html, /href="#TAC-002"/);
  assert.match(html, /href="#ADR-001"/);
});

test('renderTad renders optional sections present in the document', () => {
  const html = renderTad(
    {
      tadId: 'TAD-001',
      systemOverview: {
        executiveSummary: 'x',
        systemPurpose: 'y',
        architecturalApproach: 'z',
        keyCapabilities: ['c'],
      },
      integrationArchitecture: { apiDesign: 'rest', eventModel: 'none' },
    },
    { raw: '{}', componentIds: ['TAC-001'], architecturalDecisionIds: ['ADR-001'] },
  );
  assert.match(html, /Integration architecture/);
  assert.match(html, /apiDesign/);
});

test('renderTac emits responsibilities and interfaces', () => {
  const html = renderTac(
    {
      tacId: 'TAC-001',
      name: 'Document store',
      purpose: 'p',
      responsibilities: ['r1', 'r2'],
      interfaces: [{ name: 'loadDocument', kind: 'function', description: 'd' }],
      dependencies: [{ name: 'rcf-schemas', kind: 'external', description: 'd' }],
    },
    { raw: '{}' },
  );
  assert.match(html, /id="TAC-001"/);
  assert.match(html, /r1/);
  assert.match(html, /loadDocument/);
  assert.match(html, /rcf-schemas/);
});

test('renderAdr emits context, decision and consequences', () => {
  const html = renderAdr(
    {
      adrId: 'ADR-001',
      status: 'accepted',
      title: 't',
      context: 'c',
      decision: 'd',
      consequences: 'q',
      alternativesConsidered: [{ name: 'X', summary: 's', reasonNotChosen: 'r' }],
    },
    { raw: '{}' },
  );
  assert.match(html, /id="ADR-001"/);
  assert.match(html, /Context/);
  assert.match(html, /Decision/);
  assert.match(html, /Consequences/);
  assert.match(html, /Alternatives considered/);
});

test('renderBuildSequence renders ordered FBS slots from computed ctx.slots (D15)', () => {
  const html = renderBuildSequence(
    {
      bsId: 'BS-001',
      title: 'X',
      buildPhilosophy: 'p',
      generationStrategy: 'dependencyFirst',
    },
    {
      raw: '{}',
      slots: [
        { fbsId: 'FBS-001', buildOrder: 1, executionStatus: 'notStarted', title: 'Setup' },
        { fbsId: 'FBS-002', buildOrder: 2, executionStatus: 'notStarted', title: 'Walk' },
      ],
    },
  );
  assert.match(html, /id="BS-001"/);
  assert.match(html, /href="#FBS-001"/);
  assert.match(html, /href="#FBS-002"/);
});

test('renderFbs resolves AC ids into Given/When/Then text and emits AC pills (D8)', () => {
  const usByAcId = new Map([['AC-201-1', {
    acceptanceCriteria: [{ id: 'AC-201-1', description: 'render', given: 'g', when: 'w', then: 't' }],
  }]]);
  const html = renderFbs(
    {
      fbsId: 'FBS-003',
      title: 'Diagram rendering',
      summary: 's',
      acIds: ['AC-201-1'],
      contextRequirements: { tacIds: ['TAC-003'], adrIds: ['ADR-001'] },
      dependsOnFbsIds: ['FBS-002'],
      buildOrder: 3,
      executionStatus: 'notStarted',
      estimatedSize: 'small',
      estimatedHours: 4,
      deliverables: ['d'],
    },
    { raw: '{}', usByAcId },
  );
  assert.match(html, /id="FBS-003"/);
  assert.match(html, /Given/);
  assert.match(html, /href="#TAC-003"/);
  assert.match(html, /href="#ADR-001"/);
  assert.match(html, /href="#FBS-002"/);
  // Clickable AC pill.
  assert.match(html, /class="ac-pill" href="#AC-201-1"/);
});

test('renderFbs marks an unresolved AC reference inline', () => {
  const html = renderFbs(
    { fbsId: 'FBS-999', title: 't', summary: 's', acIds: ['AC-999-1'] },
    { raw: '{}', usByAcId: new Map() },
  );
  assert.match(html, /unresolved/);
});

test('renderBuildSequence handles an empty slot list gracefully', () => {
  const html = renderBuildSequence(
    { bsId: 'BS-001', title: 'X', buildPhilosophy: 'p', generationStrategy: 'dependencyFirst' },
    { raw: '{}', slots: [] },
  );
  assert.match(html, /id="BS-001"/);
  assert.match(html, /FBS slots/);
});

test('renderBuildSequence sorts slots by buildOrder ascending regardless of input order', () => {
  const html = renderBuildSequence(
    { bsId: 'BS-001', title: 'X', buildPhilosophy: 'p', generationStrategy: 'dependencyFirst' },
    {
      raw: '{}',
      slots: [
        { fbsId: 'FBS-002', buildOrder: 2, executionStatus: 'notStarted' },
        { fbsId: 'FBS-001', buildOrder: 1, executionStatus: 'complete' },
      ],
    },
  );
  const firstIdx = html.indexOf('FBS-001');
  const secondIdx = html.indexOf('FBS-002');
  assert.ok(firstIdx < secondIdx, 'FBS-001 (buildOrder 1) should appear before FBS-002 (buildOrder 2)');
});

test('renderFbs shows the dependsOnFbsIds list (renamed from dependencies, D6)', () => {
  const html = renderFbs(
    {
      fbsId: 'FBS-004',
      title: 'View surface',
      summary: 's',
      acIds: ['AC-201-1'],
      dependsOnFbsIds: ['FBS-001', 'FBS-002'],
      buildOrder: 4,
      executionStatus: 'notStarted',
    },
    { raw: '{}', usByAcId: new Map() },
  );
  assert.match(html, /Depends on/);
  assert.match(html, /href="#FBS-001"/);
  assert.match(html, /href="#FBS-002"/);
});

test('renderPrd falls back to no-requirements block when ctx supplies no requirementIds', () => {
  const html = renderPrd(
    {
      prdId: 'PRD-001',
      productName: 'Acme',
      problemStatement: 'p',
      objectives: ['o'],
    },
    { raw: '{}' },
  );
  assert.match(html, /Requirements/);
  assert.match(html, /none/);
});

test('renderTestSuite tolerates an empty testCases array', () => {
  const html = renderTestSuite(
    {
      id: 'TS-042',
      usId: 'US-401',
      title: 'Placeholder suite',
      purpose: 'p',
      testLevel: 'unit',
      acIds: ['AC-401-1'],
      testCases: [],
      status: 'draft',
    },
    { raw: '{}' },
  );
  assert.match(html, /id="TS-042"/);
  assert.match(html, /no test cases/);
});

test('renderTestSuite uses the id field, lists acIds, and renders inline TCs (D9)', () => {
  const html = renderTestSuite(
    {
      id: 'TS-001',
      usId: 'US-201',
      title: 'Diagram smoke',
      purpose: 'p',
      testLevel: 'unit',
      acIds: ['AC-201-1'],
      testCases: [
        { id: 'TC-001-happy', acId: 'AC-201-1', description: 'renders LR', status: 'pending' },
      ],
      status: 'draft',
    },
    { raw: '{}' },
  );
  assert.match(html, /id="TS-001"/);
  assert.match(html, /TC-001-happy/);
  assert.match(html, /href="#AC-201-1"/);
  assert.match(html, /href="#US-201"/);
});
