// Tab-structure tests for the Phase 3.2 view rework. These exercise the
// emitted HTML string, not a running browser (per §5 hard-NOs: no
// Playwright / Puppeteer). Together with html-page.test.js they cover D1,
// D2, D4, D5, D8, D10, D11 and D12 at the DOM shape level.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { walkTree } from '../../src/store/index.js';
import { renderPage } from '../../src/view/html-page.js';
import { buildTreeModel } from '../../src/view/tree-model.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

async function renderLive() {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  return { model, html: renderPage(model) };
}

test('tab bar carries four buttons in the expected order (D2)', async () => {
  const { html } = await renderLive();
  const order = ['overview', 'requirements', 'architecture', 'build'];
  let lastIdx = -1;
  for (const name of order) {
    const idx = html.indexOf(`data-tab="${name}"`);
    assert.ok(idx > -1, `missing ${name} tab`);
    assert.ok(idx > lastIdx, `tab ${name} out of order`);
    lastIdx = idx;
  }
});

test('exactly one tabpanel is visible by default (Overview)', async () => {
  const { html } = await renderLive();
  const panelMatches = [...html.matchAll(/<section id="tab-(\w+)" role="tabpanel"([^>]*)>/g)];
  const visible = panelMatches.filter((m) => !/hidden/.test(m[2]));
  const hidden = panelMatches.filter((m) => /hidden/.test(m[2]));
  assert.equal(visible.length, 1);
  assert.equal(visible[0][1], 'overview');
  assert.equal(hidden.length, 3);
});

test('Requirements tab contains the REQ drill-down as doc-details', async () => {
  const { html, model } = await renderLive();
  const reqTabStart = html.indexOf('id="tab-requirements"');
  const archTabStart = html.indexOf('id="tab-architecture"');
  assert.ok(reqTabStart > 0);
  assert.ok(archTabStart > reqTabStart);
  const reqPanel = html.slice(reqTabStart, archTabStart);
  for (const req of model.requirements) {
    assert.ok(reqPanel.includes(`data-doc-id="${req.reqId}"`), `missing REQ details for ${req.reqId}`);
  }
});

test('Requirements tab nests user stories as details inside REQ details', async () => {
  const { html, model } = await renderLive();
  for (const us of model.userStories) {
    if (!us.reqId) continue;
    assert.match(html, new RegExp(`data-doc-id="${us.usId}"`));
  }
});

test('AC list items carry raw-id anchors (D4)', async () => {
  const { html, model } = await renderLive();
  // Pick a known AC from the live tree.
  const knownAcs = [];
  for (const us of model.userStories) {
    for (const ac of us.acceptanceCriteria ?? []) knownAcs.push(ac.id);
  }
  assert.ok(knownAcs.length > 0);
  for (const acId of knownAcs.slice(0, 5)) {
    assert.match(html, new RegExp(`id="${acId}"`), `missing AC anchor for ${acId}`);
  }
});

test('Architecture tab wraps TACs and ADRs as doc-details', async () => {
  const { html, model } = await renderLive();
  for (const t of model.tacs) assert.match(html, new RegExp(`data-doc-id="${t.tacId}"`));
  for (const a of model.adrs) assert.match(html, new RegExp(`data-doc-id="${a.adrId}"`));
});

test('Build tab wraps FBSs as doc-details and renders AC pills (D8)', async () => {
  const { html, model } = await renderLive();
  for (const f of model.fbsItems) assert.match(html, new RegExp(`data-doc-id="${f.fbsId}"`));
  // Pick one FBS with a known AC.
  const fbs003 = model.fbsItems.find((f) => f.fbsId === 'FBS-003');
  assert.ok(fbs003, 'expected FBS-003 in the live tree');
  assert.match(html, /class="ac-pill" href="#AC-201-1"/);
});

test('inline script contains tab switching and hash routing logic (D5)', async () => {
  const { html } = await renderLive();
  assert.match(html, /activateTab/);
  assert.match(html, /hashchange/);
  assert.match(html, /openAncestorDetails/);
  assert.match(html, /aria-selected/);
});

test('inline script lazy-renders Mermaid on tab activation (D3, hidden-tab NaN fix)', async () => {
  // Mermaid cannot lay out diagrams inside display:none tabpanels
  // (getBoundingClientRect returns 0x0, which produces
  // "translate(undefined, NaN)" warnings in vendored Mermaid 11.6.0).
  // The inline script must therefore initialise Mermaid with
  // startOnLoad:false and run each tab's diagrams on activation.
  const { html } = await renderLive();
  assert.match(html, /startOnLoad:\s*false/);
  assert.match(html, /function runMermaidIn/);
  assert.match(html, /data-processed/);
  assert.match(html, /window\.mermaid\.run\(\{ nodes:/);
});

test('per-REQ subdiagrams carry click bindings whose hrefs use raw doc ids', async () => {
  const { html } = await renderLive();
  // With the top-of-overview diagram dropped in Phase 3.6, per-REQ subdiagrams
  // are where click bindings now live. REQ-002's subdiagram covers US-201 and AC-201-1.
  assert.match(html, /click REQ-002 &quot;#REQ-002&quot;/);
  assert.match(html, /click US-201 &quot;#US-201&quot;/);
  assert.match(html, /click AC-201-1 &quot;#AC-201-1&quot;/);
});
