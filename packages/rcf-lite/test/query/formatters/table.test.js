// Table formatter tests. Spec §4.4.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatTable } from '../../../src/query/formatters/table.js';

test('coverage table has header, mode, totals, and per-REQ rows', () => {
  const result = {
    ok: false,
    strict: false,
    totals: { requirements: 2, covered: 1, coveredUnresolved: 0, uncovered: 1 },
    requirements: [
      { id: 'REQ-001', covered: true, coverageClass: 'covered', acs: [{ id: 'AC-001-1', covered: true, testCases: ['TC-001-a'], unresolvedTestCases: [] }] },
      { id: 'REQ-002', covered: false, coverageClass: 'uncovered', acs: [{ id: 'AC-002-1', covered: false, testCases: [], unresolvedTestCases: [] }] },
    ],
    unresolvedTestPointers: [],
  };
  const out = formatTable(result, 'coverage');
  assert.match(out, /Coverage mode: shallow-any/);
  assert.match(out, /Requirements: 2/);
  assert.match(out, /covered: 1/);
  assert.match(out, /covered-unresolved: 0/);
  assert.match(out, /uncovered: 1/);
  assert.match(out, /REQ-001/);
  assert.match(out, /AC-001-1/);
  assert.match(out, /TC-001-a/);
  assert.doesNotMatch(out, /Unresolved test pointers/, 'no footer when nothing is unresolved');
});

// w-2026-07-28-005: the unresolved state is its own word everywhere it
// appears - summary counter, REQ cell, AC cell, per-TC marker, footer.
test('coverage table renders the covered-unresolved state visibly at every level', () => {
  const result = {
    ok: false,
    strict: false,
    totals: { requirements: 1, covered: 0, coveredUnresolved: 1, uncovered: 0 },
    requirements: [
      {
        id: 'REQ-001',
        covered: false,
        coverageClass: 'covered-unresolved',
        acs: [{
          id: 'AC-001-1',
          covered: false,
          testCases: ['TC-001-stub'],
          unresolvedTestCases: ['TC-001-stub'],
        }],
      },
    ],
    unresolvedTestPointers: [
      { tsId: 'TS-001', tcId: 'TC-001-stub', testPointer: 'test/gone.test.js::stub', reason: 'file-missing' },
    ],
  };
  const out = formatTable(result, 'coverage');
  assert.match(out, /covered-unresolved: 1/);
  assert.match(out, /REQ-001 {6}unresolved/);
  assert.match(out, /AC-001-1 {2}unresolved/);
  assert.match(out, /TC-001-stub\[unresolved\]/);
  assert.match(out, /Unresolved test pointers \(never counted as coverage\):/);
  assert.match(out, /TC-001-stub \(TS-001\): test\/gone\.test\.js::stub - file-missing/);
});

test('coverage table with --strict labels mode as strict', () => {
  const result = {
    ok: false, strict: true,
    totals: { requirements: 1, covered: 0, coveredUnresolved: 0, uncovered: 1 },
    requirements: [
      { id: 'REQ-001', covered: false, coverageClass: 'uncovered', acs: [{ id: 'AC-001-1', covered: false, testCases: [], unresolvedTestCases: [] }] },
    ],
    unresolvedTestPointers: [],
  };
  const out = formatTable(result, 'coverage');
  assert.match(out, /Coverage mode: strict/);
});

test('trace forward table renders Depth / Id / Kind / Title columns and populates Title from node.title', () => {
  const result = {
    pivot: 'REQ-002', direction: 'forward', found: true,
    nodes: [
      { id: 'REQ-002', kind: 'req', depth: 0, title: 'Visual review surface' },
      { id: 'US-201', kind: 'userStory', depth: 1, title: 'Render the tree as a diagram' },
    ],
    edges: [],
  };
  const out = formatTable(result, 'trace');
  assert.match(out, /Trace pivot: REQ-002/);
  assert.match(out, /direction: forward/);
  assert.match(out, /Depth\s+Id\s+Kind\s+Title/);
  assert.match(out, /REQ-002\s+req\s+Visual review surface/);
  assert.match(out, /US-201\s+userStory\s+Render the tree as a diagram/);
});

test('trace forward table renders a blank Title cell when the node carries no title', () => {
  const result = {
    pivot: 'REQ-002', direction: 'forward', found: true,
    nodes: [
      { id: 'REQ-002', kind: 'req', depth: 0, title: '' },
      { id: 'US-201', kind: 'userStory', depth: 1, title: '' },
    ],
    edges: [],
  };
  const out = formatTable(result, 'trace');
  // No title still renders the row; the Title column is blank.
  assert.match(out, /REQ-002/);
  assert.match(out, /US-201/);
});

test('trace both table populates Title in Ancestors and Descendants blocks', () => {
  const result = {
    pivot: 'US-201', direction: 'both', found: true,
    ancestors: [{ id: 'REQ-002', kind: 'req', depth: -1, title: 'Visual review surface' }],
    descendants: [{ id: 'AC-201-1', kind: 'ac', depth: 1, title: 'The tree is rendered as per-requirement subdiagrams' }],
  };
  const out = formatTable(result, 'trace');
  assert.match(out, /Ancestors:/);
  assert.match(out, /Pivot: US-201/);
  assert.match(out, /Descendants:/);
  assert.match(out, /REQ-002\s+req\s+Visual review surface/);
  assert.match(out, /AC-201-1\s+ac\s+The tree is rendered as per-requirement subdiagrams/);
});

test('impact table renders Action needed column with per-node label', () => {
  const result = {
    pivot: 'AC-201-1', found: true,
    nodes: [
      { id: 'AC-201-1', kind: 'ac', role: 'pivot', actionNeeded: null },
      { id: 'US-201', kind: 'userStory', role: 'ancestor', actionNeeded: 'review-scope' },
      { id: 'FBS-014', kind: 'fbs', role: 'descendant', actionNeeded: 're-execute' },
    ],
    edges: [],
  };
  const out = formatTable(result, 'impact');
  assert.match(out, /Impact pivot: AC-201-1/);
  assert.match(out, /Action needed/);
  assert.match(out, /review-scope/);
  assert.match(out, /re-execute/);
});

test('table renderer truncates long cells at COLUMN_CAP with ellipsis', () => {
  const longAc = 'A'.repeat(200);
  const result = {
    ok: true, strict: false,
    totals: { requirements: 1, covered: 1, coveredUnresolved: 0, uncovered: 0 },
    requirements: [
      { id: 'REQ-001', covered: true, coverageClass: 'covered', acs: [{ id: 'AC-001-1', covered: true, testCases: [longAc], unresolvedTestCases: [] }] },
    ],
    unresolvedTestPointers: [],
  };
  const out = formatTable(result, 'coverage');
  assert.match(out, /\.\.\./);
});
