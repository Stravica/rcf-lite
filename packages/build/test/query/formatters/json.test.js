// JSON formatter tests. Verifies §D15 envelope stability + camelCase.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatJson } from '../../../src/query/formatters/json.js';

test('coverage envelope has ok / strict / totals / requirements at the top', () => {
  const result = {
    ok: true, strict: false,
    totals: { requirements: 1, covered: 1, uncovered: 0 },
    requirements: [{ id: 'REQ-001', covered: true, acs: [] }],
  };
  const out = formatJson(result, 'coverage');
  const parsed = JSON.parse(out);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.strict, false);
  assert.equal(parsed.totals.requirements, 1);
  assert.equal(parsed.requirements[0].id, 'REQ-001');
});

test('trace envelope carries pivot / direction / nodes / edges', () => {
  const result = {
    pivot: 'REQ-002', direction: 'forward', found: true,
    nodes: [{ id: 'REQ-002', kind: 'req', depth: 0 }],
    edges: [],
  };
  const out = formatJson(result, 'trace');
  const parsed = JSON.parse(out);
  assert.equal(parsed.pivot, 'REQ-002');
  assert.equal(parsed.direction, 'forward');
  assert.ok(Array.isArray(parsed.nodes));
  assert.ok(Array.isArray(parsed.edges));
});

test('trace both envelope has {pivot, ancestors, descendants}', () => {
  const result = {
    pivot: 'US-201', direction: 'both', found: true,
    ancestors: [{ id: 'REQ-002', kind: 'req', depth: -1 }],
    descendants: [{ id: 'AC-201-1', kind: 'ac', depth: 1 }],
  };
  const out = formatJson(result, 'trace');
  const parsed = JSON.parse(out);
  assert.equal(parsed.pivot, 'US-201');
  assert.ok(Array.isArray(parsed.ancestors));
  assert.ok(Array.isArray(parsed.descendants));
});

test('impact envelope carries pivot / nodes / edges with camelCase actionNeeded', () => {
  const result = {
    pivot: 'AC-201-1', found: true,
    nodes: [
      { id: 'AC-201-1', kind: 'ac', role: 'pivot', actionNeeded: null },
      { id: 'US-201', kind: 'userStory', role: 'ancestor', actionNeeded: 'review-scope' },
    ],
    edges: [],
  };
  const out = formatJson(result, 'impact');
  const parsed = JSON.parse(out);
  assert.equal(parsed.pivot, 'AC-201-1');
  assert.equal(parsed.nodes[1].kind, 'userStory');
  assert.equal(parsed.nodes[1].actionNeeded, 'review-scope');
  // camelCase - no snake_case property leaks
  assert.equal(Object.keys(parsed.nodes[1]).includes('action_needed'), false);
});

test('trailing newline is present so the CLI writes a clean line', () => {
  const out = formatJson({ ok: true }, 'coverage');
  assert.ok(out.endsWith('\n'));
});
