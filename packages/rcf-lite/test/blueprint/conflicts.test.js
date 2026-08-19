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

test('renderConflictReport: leads with per-side headers (topic in parens) and names four honest resolution paths (Phase 3.5)', () => {
  const report = renderConflictReport([
    {
      kind: 'globalAdrTopic',
      topic: 'versioning',
      incoming: { slug: 'beta', id: 'ADR-005-beta', path: 'rcf/adrs/adr-005-beta.json' },
      existing: { slug: 'alpha', id: 'ADR-004-alpha', path: 'rcf/adrs/adr-004-alpha.json' },
    },
  ]);
  // Header carries the topic in parens (Phase 3.5 reshape).
  assert.match(report, /conflict on topic \(versioning\)/);
  // Per-side headers name the blueprint slug. Titles / decisions are
  // absent in this raw call, so the header falls back to id + path;
  // renderer-integration coverage of the title + decision path lives
  // in the applyBlueprint integration tests.
  assert.match(report, /incoming\s+blueprint beta:\s+ADR-005-beta at rcf\/adrs\/adr-005-beta\.json/);
  assert.match(report, /existing\s+blueprint alpha:\s+ADR-004-alpha at rcf\/adrs\/adr-004-alpha\.json/);
  // Footer refs block.
  assert.match(report, /refs:\s+ADR-005-beta at rcf\/adrs\/adr-005-beta\.json/);
  // Four honest resolutions, with actual blueprint slugs filled in
  // (no placeholder <slug> prose). The old resolution 1 ("run remove
  // on the incoming side" — a nonsensical instruction since the
  // incoming is not applied yet) is gone.
  assert.match(report, /1\. Adopt the incoming blueprint. Run:[\s\S]*rcf blueprint remove alpha/);
  assert.match(report, /2\. Keep the existing blueprint. Do not add beta on this project\./);
  assert.match(report, /3\. Author a project-level ADR that supersedes both. Run:[\s\S]*rcf blueprint supersede versioning/);
  assert.match(report, /4\. Declare the resolution on the add itself:[\s\S]*--resolve versioning=project:<ADR-id>/);
  // The unimplemented `--pick` guidance is still gone.
  assert.doesNotMatch(report, /`--pick/);
  // No placeholder <slug> prose survives.
  assert.doesNotMatch(report, /<slug>/);
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
  assert.match(report, /conflict on id ADR-201-spa-routing/);
  assert.match(report, /incoming\s+blueprint spa-theme declares ADR-201-spa-routing/);
  assert.match(report, /existing\s+blueprint spa already owns ADR-201-spa-routing/);
  // Cross-blueprint ownership resolutions are honest — no manifest
  // ruling can resolve a cross-claim; it is an author-side fix.
  assert.match(report, /1\. Adopt the incoming blueprint. Run:[\s\S]*rcf blueprint remove spa/);
  assert.match(report, /2\. Keep the existing blueprint. Do not add spa-theme on this project\./);
  assert.match(report, /3\. Fix the incoming blueprint's contribution ids/);
});
