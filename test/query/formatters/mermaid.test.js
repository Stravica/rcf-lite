// Mermaid formatter tests. Verifies §D14 orientation + class palette.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CLASS_DEFS, classForId, formatMermaid } from '../../../src/query/formatters/mermaid.js';

test('coverage mermaid emits flowchart LR header + class block', () => {
  const result = {
    ok: true, strict: false,
    totals: { requirements: 1, covered: 1, uncovered: 0 },
    requirements: [{
      id: 'REQ-001', covered: true,
      acs: [{ id: 'AC-001-1', covered: true, testCases: ['TC-001-happy'] }],
    }],
  };
  const out = formatMermaid(result, 'coverage');
  assert.match(out, /^flowchart LR/);
  assert.match(out, /REQ-001/);
  assert.match(out, /AC-001-1/);
  assert.match(out, /classDef prd/);
  assert.match(out, /classDef req/);
});

test('trace forward mermaid emits nodes + parent-child arrows (-->)', () => {
  const result = {
    pivot: 'REQ-002', direction: 'forward', found: true,
    nodes: [
      { id: 'REQ-002', kind: 'req', depth: 0 },
      { id: 'US-201', kind: 'userStory', depth: 1 },
    ],
    edges: [{ from: 'REQ-002', to: 'US-201', kind: 'parentChild' }],
  };
  const out = formatMermaid(result, 'trace');
  assert.match(out, /flowchart LR/);
  assert.match(out, /REQ-002 --> US-201/);
});

test('trace mermaid uses -.-> for cross-link edges', () => {
  const result = {
    pivot: 'AC-201-1', direction: 'forward', found: true,
    nodes: [
      { id: 'AC-201-1', kind: 'ac', depth: 0 },
      { id: 'FBS-014', kind: 'fbs', depth: 1 },
    ],
    edges: [{ from: 'AC-201-1', to: 'FBS-014', kind: 'crossLink' }],
  };
  const out = formatMermaid(result, 'trace');
  assert.match(out, /AC-201-1 -\.-> FBS-014/);
});

test('trace both mermaid emits two flowchart LR blocks around the pivot', () => {
  const result = {
    pivot: 'US-201', direction: 'both', found: true,
    ancestors: [{ id: 'REQ-002', kind: 'req', depth: -1 }],
    descendants: [{ id: 'AC-201-1', kind: 'ac', depth: 1 }],
  };
  const out = formatMermaid(result, 'trace');
  const headers = out.match(/flowchart LR/g) ?? [];
  assert.equal(headers.length, 2);
  // Pivot appears in both blocks.
  const pivotOccurrences = (out.match(/US-201\[/g) ?? []).length;
  assert.ok(pivotOccurrences >= 2, `expected pivot to appear in both blocks, got ${pivotOccurrences}`);
});

test('classForId matches the live-view palette prefixes', () => {
  assert.equal(classForId('PRD-001'), 'prd');
  assert.equal(classForId('REQ-002'), 'req');
  assert.equal(classForId('US-201'), 'us');
  assert.equal(classForId('AC-201-1'), 'ac');
  assert.equal(classForId('TAD-001'), 'tad');
  assert.equal(classForId('TAC-005'), 'tac');
  assert.equal(classForId('ADR-003'), 'adr');
  assert.equal(classForId('BS-001'), 'bs');
  assert.equal(classForId('FBS-014'), 'fbs');
  // CLASS_DEFS carries the full palette + broken class.
  assert.match(CLASS_DEFS, /classDef broken/);
});

test('impact mermaid does not emit the actionNeeded column (intent surfaces via node classes)', () => {
  const result = {
    pivot: 'AC-201-1', found: true,
    nodes: [
      { id: 'AC-201-1', kind: 'ac', role: 'pivot', actionNeeded: null },
      { id: 'FBS-014', kind: 'fbs', role: 'descendant', actionNeeded: 're-execute' },
    ],
    edges: [{ from: 'AC-201-1', to: 'FBS-014', kind: 'crossLink' }],
  };
  const out = formatMermaid(result, 'impact');
  // No `Action needed` column heading in mermaid.
  assert.equal(out.includes('Action needed'), false);
  assert.match(out, /AC-201-1 -\.-> FBS-014/);
});
