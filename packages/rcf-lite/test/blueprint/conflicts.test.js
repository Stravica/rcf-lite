// Unit tests for src/blueprint/conflicts.js. Covers AC-1002-2, AC-1002-3
// (scope:global ADR conflict detection and its report shape) and
// AC-1002-4 (namespaced non-global TACs never conflict).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { detectGlobalAdrConflicts, renderConflictReport } from '../../src/blueprint/conflicts.js';

const applied = [
  {
    slug: 'alpha',
    contributions: [
      { kind: 'adr', id: 'ADR-004-alpha', path: 'rcf/adrs/adr-004-alpha.json', scope: 'global', topic: 'versioning' },
      { kind: 'tac', id: 'TAC-002-alpha-logging', path: 'rcf/tacs/tac-002-alpha-logging.json' },
    ],
  },
];

test('detectGlobalAdrConflicts: same-topic scope:global ADR across two blueprints surfaces one conflict', () => {
  const conflicts = detectGlobalAdrConflicts(applied, {
    slug: 'beta',
    contributions: [
      { kind: 'adr', id: 'ADR-005-beta', path: 'rcf/adrs/adr-005-beta.json', scope: 'global', topic: 'versioning' },
    ],
  });
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].topic, 'versioning');
  assert.equal(conflicts[0].incoming.slug, 'beta');
  assert.equal(conflicts[0].existing.slug, 'alpha');
});

test('detectGlobalAdrConflicts: different-topic scope:global ADRs do NOT conflict', () => {
  const conflicts = detectGlobalAdrConflicts(applied, {
    slug: 'beta',
    contributions: [
      { kind: 'adr', id: 'ADR-005-beta', path: 'x', scope: 'global', topic: 'auth' },
    ],
  });
  assert.equal(conflicts.length, 0);
});

test('detectGlobalAdrConflicts: non-global ADRs do NOT conflict (namespaced)', () => {
  const conflicts = detectGlobalAdrConflicts(applied, {
    slug: 'beta',
    contributions: [
      { kind: 'adr', id: 'ADR-006-beta', path: 'x', topic: 'versioning' },
    ],
  });
  assert.equal(conflicts.length, 0);
});

test('detectGlobalAdrConflicts: namespaced TACs never conflict (AC-1002-4)', () => {
  const conflicts = detectGlobalAdrConflicts(applied, {
    slug: 'beta',
    contributions: [
      { kind: 'tac', id: 'TAC-002-beta-logging', path: 'x' },
    ],
  });
  assert.equal(conflicts.length, 0);
});

test('detectGlobalAdrConflicts: re-applying the same blueprint against itself is NOT a conflict', () => {
  const conflicts = detectGlobalAdrConflicts(applied, {
    slug: 'alpha',
    contributions: [
      { kind: 'adr', id: 'ADR-004-alpha', path: 'x', scope: 'global', topic: 'versioning' },
    ],
  });
  assert.equal(conflicts.length, 0);
});

test('renderConflictReport: lists both sides and names three resolution paths (AC-1002-3)', () => {
  const report = renderConflictReport([
    {
      kind: 'globalAdrTopic',
      topic: 'versioning',
      incoming: { slug: 'beta', id: 'ADR-005-beta', path: 'rcf/adrs/adr-005-beta.json' },
      existing: { slug: 'alpha', id: 'ADR-004-alpha', path: 'rcf/adrs/adr-004-alpha.json' },
    },
  ]);
  assert.match(report, /conflict on topic "versioning"/);
  assert.match(report, /incoming: ADR ADR-005-beta \(blueprint beta\)/);
  assert.match(report, /existing: ADR ADR-004-alpha \(blueprint alpha\)/);
  // Three resolutions named.
  assert.match(report, /1\. `--pick <slug>`/);
  assert.match(report, /2\. Author a project-level ADR that supersedes both/);
  assert.match(report, /3\. Decline/);
});

test('renderConflictReport: empty conflict list returns empty string', () => {
  assert.equal(renderConflictReport([]), '');
});
