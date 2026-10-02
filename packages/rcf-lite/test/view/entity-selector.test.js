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

test('EntitySelector: payload rides on the container as a data-items attribute (no inline <script> body)', () => {
  const html = renderEntitySelector({
    hashKey: 'reqs', targetTab: 'requirements', facetKey: 'domain', items: SAMPLE,
  });
  // The shell contract (PR 1): no <script> element without a src.
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)/);
  const m = html.match(/data-items="([^"]*)"/);
  assert.ok(m, 'data-items attribute present');
  // HTML entities decode before JSON.parse (escapeHtml replaces
  // &, <, >, ", ' with their entities).
  const decoded = m[1]
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
  const parsed = JSON.parse(decoded);
  assert.equal(parsed.length, SAMPLE.length);
  assert.equal(parsed[0].id, 'REQ-001');
  assert.equal(parsed[0].facet, 'projectStructure');
});

test('EntitySelector: a </script> or quote in a title cannot break out of the data-items attribute', () => {
  const html = renderEntitySelector({
    hashKey: 'reqs',
    targetTab: 'requirements',
    facetKey: 'domain',
    items: [{ id: 'REQ-001', title: 'Hack "</script><script>alert(1)</script>', facet: 'x' }],
  });
  // No bare <script> tag (payload is an attribute now).
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)/);
  // The attribute boundary stays intact: the double-quote in the title
  // escapes to &quot; inside the attribute.
  const m = html.match(/data-items="([^"]*)"/);
  assert.ok(m, 'data-items attribute closes cleanly');
  assert.ok(m[1].indexOf('&quot;') !== -1);
});
