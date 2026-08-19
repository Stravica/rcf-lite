// Unit tests for src/blueprint/conflicts.js. Covers AC-1002-2, AC-1002-3
// (scope:global ADR conflict detection and its report shape),
// AC-1002-4 (namespaced non-global TACs never conflict), and
// w-2026-08-19-005 (cross-blueprint ownership claims via the
// authoritative manifest record).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  detectCrossBlueprintClaims,
  detectGlobalAdrConflicts,
  renderConflictReport,
} from '../../src/blueprint/conflicts.js';

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
  // Three resolutions named. Phase 3 introduces `--pick` (and the wider
  // conflict-resolution verbs) with its own ergonomics gate; until then
  // the report names implemented paths only (remove-then-re-add).
  assert.match(report, /1\. Keep the currently applied blueprint/);
  assert.match(report, /2\. Adopt the incoming blueprint instead/);
  assert.match(report, /3\. Author a project-level ADR that supersedes both/);
  // The unimplemented `--pick` guidance is gone; a user following it hit
  // `parseArgs strict:true` and exited 2 on an unknown option.
  assert.doesNotMatch(report, /`--pick/);
});

test('renderConflictReport: empty conflict list returns empty string', () => {
  assert.equal(renderConflictReport([]), '');
});

// ---------------------------------------------------------------------------
// w-2026-08-19-005: cross-blueprint ownership claims. The manifest is
// the authoritative record; an incoming id already owned by a DIFFERENT
// applied blueprint is refused regardless of how the id string parses.
// ---------------------------------------------------------------------------

test('detectCrossBlueprintClaims: incoming id already owned by another applied blueprint surfaces one conflict', () => {
  const applied = [
    { slug: 'spa', contributions: [
      { kind: 'adr', id: 'ADR-201-spa-routing', path: 'rcf/adrs/adr-201-spa-routing.json' },
    ] },
  ];
  const conflicts = detectCrossBlueprintClaims(applied, {
    slug: 'spa-theme',
    contributions: [
      { kind: 'adr', id: 'ADR-201-spa-routing', path: 'rcf/adrs/adr-201-spa-routing.json' },
    ],
  });
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].kind, 'crossBlueprintOwnership');
  assert.equal(conflicts[0].id, 'ADR-201-spa-routing');
  assert.equal(conflicts[0].incoming.slug, 'spa-theme');
  assert.equal(conflicts[0].existing.slug, 'spa');
});

test('detectCrossBlueprintClaims: re-apply of the SAME slug is NOT a claim conflict (idempotency path)', () => {
  const applied = [
    { slug: 'spa', contributions: [
      { kind: 'adr', id: 'ADR-201-spa-routing', path: 'rcf/adrs/adr-201-spa-routing.json' },
    ] },
  ];
  const conflicts = detectCrossBlueprintClaims(applied, {
    slug: 'spa',
    contributions: [
      { kind: 'adr', id: 'ADR-201-spa-routing', path: 'rcf/adrs/adr-201-spa-routing.json' },
    ],
  });
  assert.equal(conflicts.length, 0);
});

test('detectCrossBlueprintClaims: incoming id NOT recorded on any other blueprint is not a conflict', () => {
  const applied = [
    { slug: 'spa', contributions: [
      { kind: 'adr', id: 'ADR-201-spa-routing', path: 'x' },
    ] },
  ];
  const conflicts = detectCrossBlueprintClaims(applied, {
    slug: 'spa-theme',
    contributions: [
      { kind: 'adr', id: 'ADR-202-spa-theme', path: 'y' },
    ],
  });
  assert.equal(conflicts.length, 0);
});

test('renderConflictReport: renders a crossBlueprintOwnership conflict with the id + both slugs', () => {
  const report = renderConflictReport([
    {
      kind: 'crossBlueprintOwnership',
      id: 'ADR-201-spa-routing',
      incoming: { slug: 'spa-theme', path: 'rcf/adrs/adr-201-spa-routing.json' },
      existing: { slug: 'spa', path: 'rcf/adrs/adr-201-spa-routing.json' },
    },
  ]);
  assert.match(report, /conflict on id "ADR-201-spa-routing"/);
  assert.match(report, /incoming: blueprint spa-theme declares ADR-201-spa-routing/);
  assert.match(report, /existing: blueprint spa already owns ADR-201-spa-routing/);
});
