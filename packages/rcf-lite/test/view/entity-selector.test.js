// Viewer UI refresh PR 3 (decision 4): unit coverage for the shared
// EntitySelector helper. Pure string builder; wire-up is tested
// elsewhere (requirements-tab.test.js runs the html-page assembly).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderEntitySelector } from '../../src/view/components/entity-selector.js';

const SAMPLE = [
  { id: 'REQ-001', title: 'On-disk structure', facet: 'projectStructure' },
  { id: 'REQ-002', title: 'Visual review surface', facet: 'view' },
  { id: 'REQ-003', title: 'Deterministic CRUD', facet: 'crud' },
  { id: 'REQ-010', title: 'Blueprint library', facet: 'cli' },
  { id: 'REQ-011', title: 'E2E verify', facet: 'verify' },
  { id: 'REQ-012', title: 'Blueprint shelf', facet: 'cli' },
];

test('EntitySelector: data-rcf-entity-selector and target-tab attributes', () => {
  const html = renderEntitySelector({
    hashKey: 'requirements', targetTab: 'requirements', facetKey: 'domain', items: SAMPLE,
  });
  assert.match(html, /data-rcf-entity-selector="requirements"/);
  assert.match(html, /data-target-tab="requirements"/);
  assert.match(html, /data-facet-key="domain"/);
});

test('EntitySelector: total line defaults to item + area count', () => {
  const html = renderEntitySelector({
    hashKey: 'reqs', targetTab: 'requirements', facetKey: 'domain', items: SAMPLE,
  });
  // 6 items, 5 unique facets.
  assert.match(html, /6 items in 5 areas/);
});

test('EntitySelector: an explicit totalLabel overrides the default', () => {
  const html = renderEntitySelector({
    hashKey: 'reqs', targetTab: 'requirements', facetKey: 'domain', items: SAMPLE,
    totalLabel: '109 requirements in 21 areas, 182 stories, 456 acceptance criteria',
  });
  assert.match(html, /109 requirements in 21 areas/);
});

test('EntitySelector: area chips carry hash deep-links into the target tab', () => {
  const html = renderEntitySelector({
    hashKey: 'reqs', targetTab: 'requirements', facetKey: 'domain', items: SAMPLE,
  });
  assert.match(html, /href="#tab=requirements&amp;domain=cli"/);
  assert.match(html, /href="#tab=requirements&amp;domain=view"/);
});

test('EntitySelector: chip rows sort by count desc then value asc', () => {
  const html = renderEntitySelector({
    hashKey: 'reqs', targetTab: 'requirements', facetKey: 'domain', items: SAMPLE,
  });
  // cli has 2 items, every other facet 1; cli should come first.
  const chips = [...html.matchAll(/data-facet-value="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(chips[0], 'cli');
});

test('EntitySelector: explicit facets are honoured as given (order, labels)', () => {
  const html = renderEntitySelector({
    hashKey: 'reqs',
    targetTab: 'requirements',
    facetKey: 'domain',
    items: SAMPLE,
    facets: [
      { value: 'view', count: 1, label: 'view' },
      { value: 'cli', count: 2, label: 'cli' },
    ],
  });
  const chips = [...html.matchAll(/data-facet-value="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(chips, ['view', 'cli']);
});

test('EntitySelector: results pane starts hidden', () => {
  const html = renderEntitySelector({
    hashKey: 'reqs', targetTab: 'requirements', facetKey: 'domain', items: SAMPLE,
  });
  assert.match(html, /class="rcf-entity-selector-results" hidden/);
});

test('EntitySelector: payload is a <script type="application/json"> with item data', () => {
  const html = renderEntitySelector({
    hashKey: 'reqs', targetTab: 'requirements', facetKey: 'domain', items: SAMPLE,
  });
  const m = html.match(/<script type="application\/json" class="rcf-entity-selector-data">([\s\S]*?)<\/script>/);
  assert.ok(m, 'payload script present');
  const parsed = JSON.parse(m[1]);
  assert.equal(parsed.length, SAMPLE.length);
  assert.equal(parsed[0].id, 'REQ-001');
  assert.equal(parsed[0].facet, 'projectStructure');
});

test('EntitySelector: closes </script> in a title cannot escape the host script tag', () => {
  const html = renderEntitySelector({
    hashKey: 'reqs',
    targetTab: 'requirements',
    facetKey: 'domain',
    items: [{ id: 'REQ-001', title: 'Hack </script><script>alert(1)</script>', facet: 'x' }],
  });
  // Only one </script> can appear (the real closing tag). Any payload
  // interior "</" is encoded as </.
  const closes = (html.match(/<\/script>/g) ?? []).length;
  assert.equal(closes, 1);
});
