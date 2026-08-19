// Tests for src/blueprint/diff.js (Phase 3.5): side-by-side view of
// every applied blueprint's scope:global ADR on a topic.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { diffBlueprintTopic, renderDiff } from '../../src/blueprint/diff.js';

function fakeTree({ blueprints = [], byId = new Map() } = {}) {
  return { manifest: { blueprints }, byId };
}

test('diffBlueprintTopic: returns one entry per applied blueprint carrying a scope:global ADR on the topic', () => {
  const tree = fakeTree({
    blueprints: [
      {
        slug: 'spa',
        contributions: [
          { id: 'ADR-005-spa', kind: 'adr', path: 'rcf/adrs/adr-005-spa.json', scope: 'global', topic: 'auth' },
        ],
      },
      {
        slug: 'rest',
        contributions: [
          { id: 'ADR-003-rest', kind: 'adr', path: 'rcf/adrs/adr-003-rest.json', scope: 'global', topic: 'auth' },
          { id: 'ADR-004-rest', kind: 'adr', path: 'rcf/adrs/adr-004-rest.json', scope: 'global', topic: 'versioning' },
        ],
      },
    ],
    byId: new Map([
      ['ADR-005-spa',  { title: 'SPA auth: cookies',       decision: 'HttpOnly cookies.', status: 'accepted' }],
      ['ADR-003-rest', { title: 'REST auth: bearer tokens', decision: 'JWT bearer.',       status: 'accepted' }],
    ]),
  });
  const diff = diffBlueprintTopic({ tree, topic: 'auth' });
  assert.equal(diff.topic, 'auth');
  assert.equal(diff.entries.length, 2);
  const bySlug = Object.fromEntries(diff.entries.map((e) => [e.slug, e]));
  assert.equal(bySlug.spa.adrId, 'ADR-005-spa');
  assert.equal(bySlug.spa.title, 'SPA auth: cookies');
  assert.equal(bySlug.rest.decision, 'JWT bearer.');
});

test('diffBlueprintTopic: returns zero entries when no blueprint carries a global ADR on the topic', () => {
  const tree = fakeTree({
    blueprints: [
      {
        slug: 'spa',
        contributions: [
          { id: 'ADR-005-spa', kind: 'adr', path: 'x', scope: 'global', topic: 'auth' },
        ],
      },
    ],
  });
  const diff = diffBlueprintTopic({ tree, topic: 'versioning' });
  assert.equal(diff.entries.length, 0);
});

test('renderDiff: renders both sides with title / status / decision when the tree loaded the ADR body', () => {
  const tree = fakeTree({
    blueprints: [
      { slug: 'spa',  contributions: [{ id: 'ADR-005-spa',  kind: 'adr', path: 'p1', scope: 'global', topic: 'auth' }] },
      { slug: 'rest', contributions: [{ id: 'ADR-003-rest', kind: 'adr', path: 'p2', scope: 'global', topic: 'auth' }] },
    ],
    byId: new Map([
      ['ADR-005-spa',  { title: 'A', decision: 'Adecision', status: 'accepted' }],
      ['ADR-003-rest', { title: 'B', decision: 'Bdecision', status: 'accepted' }],
    ]),
  });
  const diff = diffBlueprintTopic({ tree, topic: 'auth' });
  const out = renderDiff(diff);
  assert.match(out, /blueprint diff on topic \(auth\): 2 scope:global ADR/);
  assert.match(out, /\[1\] blueprint spa/);
  assert.match(out, /title:\s+A/);
  assert.match(out, /decision:\s+Adecision/);
  assert.match(out, /\[2\] blueprint rest/);
  assert.match(out, /title:\s+B/);
});

test('renderDiff: prints an explicit "no applied blueprint" line when entries are empty', () => {
  const diff = { topic: 'auth', entries: [] };
  const out = renderDiff(diff);
  assert.match(out, /0 scope:global ADR/);
  assert.match(out, /no applied blueprint carries a scope:global ADR on 'auth'/);
});
