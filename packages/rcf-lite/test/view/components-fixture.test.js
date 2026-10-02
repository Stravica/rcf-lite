// Fixture-page composition tests for the viewer UI refresh PR 2.
// Pins the shape of the /_fixtures/components page and verifies every
// shared component is exercised by it in isolation. Also walks the
// live-router at the URL path to confirm the asset round-trips over
// HTTP exactly as the component helpers emit it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { createRouter } from '../../src/server/routes.js';
import { componentSections, renderComponentsFixturePage } from '../../src/view/components-fixture.js';

test('componentSections exposes every shared component by id', () => {
  const sections = componentSections();
  const ids = sections.map((s) => s.id);
  assert.deepEqual(ids, ['doc-row', 'filter-bar', 'badge', 'empty-state', 'toast', 'sub-tab-strip', 'entity-selector']);
  for (const s of sections) {
    assert.ok(typeof s.title === 'string' && s.title.length > 0, `${s.id} missing title`);
    assert.ok(typeof s.intent === 'string' && s.intent.length > 0, `${s.id} missing intent`);
    assert.ok(typeof s.html === 'string' && s.html.length > 0, `${s.id} missing html`);
  }
});

test('renderComponentsFixturePage: self-contained HTML5 document with the production assets', () => {
  const html = renderComponentsFixturePage();
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /<title>Viewer UI refresh - component fixtures<\/title>/);
  assert.match(html, /<link rel="stylesheet" href="\.\/style\.css">/);
  assert.match(html, /<script src="\.\/page-init\.js" defer><\/script>/);
  assert.match(html, /<\/html>\s*$/);
});

test('renderComponentsFixturePage: each component renders in its own section', () => {
  const html = renderComponentsFixturePage();
  for (const slug of ['doc-row', 'filter-bar', 'badge', 'empty-state', 'toast', 'sub-tab-strip', 'entity-selector']) {
    assert.match(
      html,
      new RegExp(`<section id="${slug}" class="rcf-fixture-section">`),
      `missing fixture section for ${slug}`,
    );
  }
  // DocRow sample: both closed and open rows present.
  assert.match(html, /data-doc-id="REQ-002"/);
  assert.match(html, /data-doc-id="REQ-003"[^>]*open/);
  // FilterBar sample: text input, two selects, one toggle, count.
  assert.match(html, /class="rcf-filterbar filterbar"/);
  assert.match(html, /data-filter-key="area"/);
  assert.match(html, /data-filter-key="needsWork"/);
  assert.match(html, /11 of 24 visible/);
  // Badge sample: all three variants surface.
  assert.match(html, /rcf-badge--count/);
  assert.match(html, /rcf-badge--facet/);
  assert.match(html, /rcf-badge--accent/);
  // EmptyState sample.
  assert.match(html, /class="rcf-empty-state empty"/);
  // Toast container + a demo button that fires window.rcfView.showToast.
  assert.match(html, /class="rcf-toast toast"/);
  assert.match(html, /data-rcf-fixture-toast/);
  // SubTabStrip sample.
  assert.match(html, /data-rcf-subtabstrip="build"/);
});

test('renderComponentsFixturePage: carries a theme toggle group', () => {
  const html = renderComponentsFixturePage();
  for (const mode of ['light', 'dark', 'auto']) {
    assert.match(html, new RegExp(`data-rcf-fixture-theme="${mode}"`));
  }
});

test('/_fixtures/components is served by the live router', async () => {
  const router = createRouter({
    currentState: () => null,
    sse: { handle: () => {} },
  });
  const server = createServer(router);
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
    server.once('error', reject);
  });
  try {
    const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
    const res = await fetch(`http://127.0.0.1:${port}/_fixtures/components`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/html/);
    const body = await res.text();
    assert.match(body, /<title>Viewer UI refresh - component fixtures<\/title>/);
    assert.match(body, /data-rcf-fixture-toast/);
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
  }
});
