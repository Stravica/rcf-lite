// Unit tests for src/blueprint/resolutions.js (Phase 3.5).
//
// Covers id-mint monotonicity and matching-resolution predicate.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { matchingResolution, nextResolutionId } from '../../src/blueprint/resolutions.js';

test('nextResolutionId: first mint on an empty manifest is res-YYYY-MM-DD-001', () => {
  const now = new Date('2026-08-19T09:00:00Z');
  assert.equal(nextResolutionId({}, now), 'res-2026-08-19-001');
  assert.equal(nextResolutionId(null, now), 'res-2026-08-19-001');
  assert.equal(nextResolutionId({ resolutions: [] }, now), 'res-2026-08-19-001');
});

test('nextResolutionId: monotonic per day, ignores other-day entries', () => {
  const now = new Date('2026-08-19T09:00:00Z');
  const manifest = {
    resolutions: [
      { id: 'res-2026-08-18-005' },
      { id: 'res-2026-08-19-001' },
      { id: 'res-2026-08-19-002' },
      { id: 'res-2026-08-20-001' },
    ],
  };
  assert.equal(nextResolutionId(manifest, now), 'res-2026-08-19-003');
});

test('nextResolutionId: ignores malformed ids', () => {
  const now = new Date('2026-08-19T09:00:00Z');
  const manifest = {
    resolutions: [
      { id: null },
      { id: 'resolution-1' },
      { id: 'res-2026-08-19-042' },
    ],
  };
  assert.equal(nextResolutionId(manifest, now), 'res-2026-08-19-043');
});

test('matchingResolution: returns the record when kind + topic + both {slug,adrId} pairs match', () => {
  const manifest = {
    resolutions: [
      {
        id: 'res-2026-08-19-001',
        kind: 'globalAdrTopic',
        topic: 'auth',
        resolvedByAdrId: 'ADR-042',
        supersedes: [
          { slug: 'spa',  adrId: 'ADR-005-spa' },
          { slug: 'rest', adrId: 'ADR-003-rest' },
        ],
      },
    ],
  };
  const hit = matchingResolution(manifest, {
    topic: 'auth',
    incoming: { slug: 'rest', adrId: 'ADR-003-rest' },
    existing: { slug: 'spa',  adrId: 'ADR-005-spa' },
  });
  assert.ok(hit);
  assert.equal(hit.resolvedByAdrId, 'ADR-042');
});

test('matchingResolution: topic mismatch returns null', () => {
  const manifest = {
    resolutions: [
      {
        id: 'res-2026-08-19-001',
        kind: 'globalAdrTopic',
        topic: 'auth',
        supersedes: [
          { slug: 'spa', adrId: 'ADR-005-spa' },
          { slug: 'rest', adrId: 'ADR-003-rest' },
        ],
      },
    ],
  };
  assert.equal(
    matchingResolution(manifest, {
      topic: 'versioning',
      incoming: { slug: 'rest', adrId: 'ADR-003-rest' },
      existing: { slug: 'spa',  adrId: 'ADR-005-spa' },
    }),
    null,
  );
});

test('matchingResolution: partial supersedes coverage (one side missing) returns null', () => {
  const manifest = {
    resolutions: [
      {
        id: 'res-2026-08-19-001',
        kind: 'globalAdrTopic',
        topic: 'auth',
        supersedes: [
          { slug: 'spa', adrId: 'ADR-005-spa' },
        ],
      },
    ],
  };
  assert.equal(
    matchingResolution(manifest, {
      topic: 'auth',
      incoming: { slug: 'rest', adrId: 'ADR-003-rest' },
      existing: { slug: 'spa',  adrId: 'ADR-005-spa' },
    }),
    null,
  );
});

test('matchingResolution: superset supersedes coverage still matches (three blueprints resolution matches two-blueprint conflict)', () => {
  const manifest = {
    resolutions: [
      {
        id: 'res-2026-08-19-001',
        kind: 'globalAdrTopic',
        topic: 'auth',
        supersedes: [
          { slug: 'spa',   adrId: 'ADR-005-spa' },
          { slug: 'rest',  adrId: 'ADR-003-rest' },
          { slug: 'admin', adrId: 'ADR-002-admin' },
        ],
      },
    ],
  };
  const hit = matchingResolution(manifest, {
    topic: 'auth',
    incoming: { slug: 'rest', adrId: 'ADR-003-rest' },
    existing: { slug: 'spa',  adrId: 'ADR-005-spa' },
  });
  assert.ok(hit);
});

test('matchingResolution: kind other than globalAdrTopic is ignored', () => {
  const manifest = {
    resolutions: [
      {
        id: 'res-2026-08-19-001',
        kind: 'somethingElse',
        topic: 'auth',
        supersedes: [
          { slug: 'spa',  adrId: 'ADR-005-spa' },
          { slug: 'rest', adrId: 'ADR-003-rest' },
        ],
      },
    ],
  };
  assert.equal(
    matchingResolution(manifest, {
      topic: 'auth',
      incoming: { slug: 'rest', adrId: 'ADR-003-rest' },
      existing: { slug: 'spa',  adrId: 'ADR-005-spa' },
    }),
    null,
  );
});

test('matchingResolution: adrId mismatch (one side lists a different ADR id) returns null', () => {
  const manifest = {
    resolutions: [
      {
        id: 'res-2026-08-19-001',
        kind: 'globalAdrTopic',
        topic: 'auth',
        supersedes: [
          { slug: 'spa',  adrId: 'ADR-005-spa' },
          { slug: 'rest', adrId: 'ADR-999-rest' },
        ],
      },
    ],
  };
  assert.equal(
    matchingResolution(manifest, {
      topic: 'auth',
      incoming: { slug: 'rest', adrId: 'ADR-003-rest' },
      existing: { slug: 'spa',  adrId: 'ADR-005-spa' },
    }),
    null,
  );
});

test('matchingResolution: empty / missing resolutions[] returns null', () => {
  assert.equal(matchingResolution({}, {
    topic: 'auth',
    incoming: { slug: 'rest', adrId: 'ADR-003-rest' },
    existing: { slug: 'spa',  adrId: 'ADR-005-spa' },
  }), null);
  assert.equal(matchingResolution({ resolutions: [] }, {
    topic: 'auth',
    incoming: { slug: 'rest', adrId: 'ADR-003-rest' },
    existing: { slug: 'spa',  adrId: 'ADR-005-spa' },
  }), null);
  assert.equal(matchingResolution(null, {
    topic: 'auth',
    incoming: { slug: 'rest', adrId: 'ADR-003-rest' },
    existing: { slug: 'spa',  adrId: 'ADR-005-spa' },
  }), null);
});
