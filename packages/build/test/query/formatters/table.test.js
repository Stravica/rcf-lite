// Table formatter tests. Spec §4.4.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatTable } from '../../../src/query/formatters/table.js';

test('coverage table has header, mode, totals, and per-REQ rows', () => {
  const result = {
    ok: false,
    strict: false,
    totals: { requirements: 2, covered: 1, uncovered: 1 },
    requirements: [
      { id: 'REQ-001', covered: true, acs: [{ id: 'AC-001-1', covered: true, testCases: ['TC-001-a'] }] },
      { id: 'REQ-002', covered: false, acs: [{ id: 'AC-002-1', covered: false, testCases: [] }] },
    ],
  };
  const out = formatTable(result, 'coverage');
  assert.match(out, /Coverage mode: shallow-any/);
  assert.match(out, /Requirements: 2/);
  assert.match(out, /covered: 1/);
  assert.match(out, /uncovered: 1/);
  assert.match(out, /REQ-001/);
  assert.match(out, /AC-001-1/);
  assert.match(out, /TC-001-a/);
});

test('coverage table with --strict labels mode as strict', () => {
  const result = {
    ok: false, strict: true,
    totals: { requirements: 1, covered: 0, uncovered: 1 },
    requirements: [
      { id: 'REQ-001', covered: false, acs: [{ id: 'AC-001-1', covered: false, testCases: [] }] },
    ],
  };
  const out = formatTable(result, 'coverage');
  assert.match(out, /Coverage mode: strict/);
});

test('trace forward table renders Depth / Id / Kind columns', () => {
  const result = {
    pivot: 'REQ-002', direction: 'forward', found: true,
    nodes: [
      { id: 'REQ-002', kind: 'req', depth: 0 },
      { id: 'US-201', kind: 'userStory', depth: 1 },
    ],
    edges: [],
  };
  const out = formatTable(result, 'trace');
  assert.match(out, /Trace pivot: REQ-002/);
  assert.match(out, /direction: forward/);
  assert.match(out, /Depth/);
  assert.match(out, /REQ-002/);
  assert.match(out, /US-201/);
});

test('trace both table renders labelled Ancestors / Pivot / Descendants blocks', () => {
  const result = {
    pivot: 'US-201', direction: 'both', found: true,
    ancestors: [{ id: 'REQ-002', kind: 'req', depth: -1 }],
    descendants: [{ id: 'AC-201-1', kind: 'ac', depth: 1 }],
  };
  const out = formatTable(result, 'trace');
  assert.match(out, /Ancestors:/);
  assert.match(out, /Pivot: US-201/);
  assert.match(out, /Descendants:/);
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
    totals: { requirements: 1, covered: 1, uncovered: 0 },
    requirements: [
      { id: 'REQ-001', covered: true, acs: [{ id: 'AC-001-1', covered: true, testCases: [longAc] }] },
    ],
  };
  const out = formatTable(result, 'coverage');
  assert.match(out, /\.\.\./);
});
