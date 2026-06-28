// Per-document renderer tests. Each asserts on structural elements (anchors,
// curated key fields, raw JSON disclosure) rather than full HTML snapshots
// (per spec §9.5).

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

test('renderPrd emits a doc-prd article with the prd anchor', () => {
  const html = renderPrd(
    {
      prdId: 'PRD-001',
      productName: 'Acme',
      executiveSummary: 'one paragraph',
      problemStatement: 'p',
      objectives: ['o'],
      requirementIds: ['REQ-001', 'REQ-002'],
    },
    { raw: '{}' },
  );
  assert.match(html, /id="doc-prd-001"/);
  assert.match(html, /doc-prd/);
  assert.match(html, /Acme/);
  assert.match(html, /href="#doc-req-001"/);
  assert.match(html, /href="#doc-req-002"/);
  assert.match(html, /Show raw JSON/);
});

test('renderReq lists user stories and embeds subdiagram when supplied', () => {
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
      userStories: [{ usId: 'US-201', title: 'Render' }],
      subdiagram: 'flowchart LR\n  REQ-002 --> US-201',
    },
  );
  assert.match(html, /id="doc-req-002"/);
  assert.match(html, /US-201 - Render/);
  assert.match(html, /<pre class="mermaid">/);
  assert.match(html, /flowchart LR/);
});

test('renderUserStory renders Given / When / Then for each AC and links to delivering FBSs', () => {
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
  assert.match(html, /id="doc-us-201"/);
  assert.match(html, /id="doc-ac-201-1"/);
  assert.match(html, /Given/);
  assert.match(html, /When/);
  assert.match(html, /Then/);
  assert.match(html, /href="#doc-fbs-003"/);
  assert.match(html, /href="#doc-req-002"/);
});

test('renderTad iterates architecturePrinciples and lists components and ADRs', () => {
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
      componentIds: ['TAC-001', 'TAC-002'],
      architecturalDecisionIds: ['ADR-001'],
    },
    { raw: '{}' },
  );
  assert.match(html, /id="doc-tad-001"/);
  assert.match(html, /P1/);
  assert.match(html, /P2/);
  assert.match(html, /href="#doc-tac-001"/);
  assert.match(html, /href="#doc-tac-002"/);
  assert.match(html, /href="#doc-adr-001"/);
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
      componentIds: ['TAC-001'],
      architecturalDecisionIds: ['ADR-001'],
      integrationArchitecture: { apiDesign: 'rest', eventModel: 'none' },
    },
    { raw: '{}' },
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
  assert.match(html, /id="doc-tac-001"/);
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
  assert.match(html, /id="doc-adr-001"/);
  assert.match(html, /Context/);
  assert.match(html, /Decision/);
  assert.match(html, /Consequences/);
  assert.match(html, /Alternatives considered/);
});

test('renderBuildSequence renders ordered FBS slots with links', () => {
  const html = renderBuildSequence(
    {
      bsId: 'BS-001',
      title: 'X',
      buildPhilosophy: 'p',
      generationStrategy: 'dependencyFirst',
      fbs: [
        { fbsId: 'FBS-001', order: 1, status: 'notStarted' },
        { fbsId: 'FBS-002', order: 2, status: 'notStarted' },
      ],
    },
    { raw: '{}' },
  );
  assert.match(html, /id="doc-bs-001"/);
  assert.match(html, /href="#doc-fbs-001"/);
  assert.match(html, /href="#doc-fbs-002"/);
});

test('renderFbs resolves AC ids into Given/When/Then text', () => {
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
      dependencies: ['FBS-002'],
      estimatedSize: 'small',
      estimatedHours: 4,
      deliverables: ['d'],
    },
    { raw: '{}', usByAcId },
  );
  assert.match(html, /id="doc-fbs-003"/);
  assert.match(html, /Given/);
  assert.match(html, /href="#doc-tac-003"/);
  assert.match(html, /href="#doc-adr-001"/);
  assert.match(html, /href="#doc-fbs-002"/);
});

test('renderFbs marks an unresolved AC reference inline', () => {
  const html = renderFbs(
    { fbsId: 'FBS-999', title: 't', summary: 's', acIds: ['AC-999-1'] },
    { raw: '{}', usByAcId: new Map() },
  );
  assert.match(html, /unresolved/);
});

test('renderTestSuite emits test cases as Given/When/Then blocks', () => {
  const html = renderTestSuite(
    {
      tsId: 'TS-001',
      acId: 'AC-201-1',
      testCases: [{ tcId: 'TC-001', given: 'g', when: 'w', then: 't' }],
    },
    { raw: '{}' },
  );
  assert.match(html, /id="doc-ts-001"/);
  assert.match(html, /TC-001/);
  assert.match(html, /Given/);
  assert.match(html, /href="#doc-ac-201-1"/);
});
