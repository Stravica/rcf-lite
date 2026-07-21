import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { walkTree } from '@stravica-ai/rcf-lite-core/store';
import { renderContent, renderPage } from '../../src/view/html-page.js';
import { buildTreeModel } from '../../src/view/tree-model.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

test('renderPage emits a valid HTML5 document (AC-202-1)', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const html = renderPage(model);
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /<html lang="en-GB">/);
  assert.match(html, /<title>/);
  assert.match(html, /<\/html>\s*$/);
});

test('renderPage includes one Mermaid block per requirement (per-REQ subdiagrams)', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const html = renderPage(model);
  // Phase 3.6 dropped the top-of-overview diagram; only per-REQ subdiagrams remain.
  const blocks = html.match(/class="mermaid[^"]*"/g) ?? [];
  assert.equal(blocks.length, model.requirements.length);
});

test('renderPage carries an anchor per document via data-doc-id or id', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const html = renderPage(model);
  for (const id of ['PRD-001', 'REQ-002', 'US-201', 'TAD-001', 'TAC-001', 'ADR-001', 'BS-001', 'FBS-003']) {
    assert.ok(
      html.includes(`data-doc-id="${id}"`) || html.includes(`id="${id}"`),
      `missing anchor for ${id}`,
    );
  }
});

test('renderPage emits a four-tab layout (D1, D2)', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const html = renderPage(model);
  for (const name of ['overview', 'requirements', 'architecture', 'build']) {
    assert.match(html, new RegExp(`data-tab="${name}"`));
    assert.match(html, new RegExp(`id="tab-${name}"`));
  }
  assert.match(html, /role="tablist"/);
  const tabpanels = html.match(/<section id="tab-\w+" role="tabpanel"/g) ?? [];
  assert.equal(tabpanels.length, 4);
});

test('renderPage marks non-Overview tabpanels hidden and Overview default (D12)', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const html = renderPage(model);
  assert.match(html, /id="tab-overview"[^>]*role="tabpanel"(?![^>]*hidden)/);
  assert.match(html, /id="tab-requirements"[^>]*role="tabpanel"[^>]*hidden/);
  assert.match(html, /id="tab-architecture"[^>]*role="tabpanel"[^>]*hidden/);
  assert.match(html, /id="tab-build"[^>]*role="tabpanel"[^>]*hidden/);
});

test('renderPage references mermaid.min.js as a relative script tag (AC-202-1)', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const html = renderPage(model);
  assert.match(html, /<script src="mermaid.min.js"/);
});

test('renderPage emits an inline client-side script with tabs and hashchange (D5)', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const html = renderPage(model);
  assert.match(html, /hashchange/);
  assert.match(html, /role="tab"/);
  assert.match(html, /mermaid\.initialize/);
});

test('renderPage embeds an inline SVG favicon (D11)', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const html = renderPage(model);
  assert.match(html, /<link rel="icon" type="image\/svg\+xml" href="data:image\/svg\+xml,/);
});

test('renderPage renders curated key fields, not raw JSON (AC-202-2)', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const html = renderPage(model);
  assert.match(html, /<strong>Executive summary:<\/strong>/);
  assert.match(html, /<strong>As a:<\/strong>/);
  assert.match(html, /Given/);
  // Raw JSON disclosure is collapsed by default.
  assert.match(html, /<details/);
  assert.match(html, /Show raw JSON/);
});

test('renderPage wraps requirements in doc-details drill-down (D4)', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const html = renderPage(model);
  // At least one REQ wrapped as details, and USs nested inside as details.
  assert.match(html, /<details[^>]*data-doc-id="REQ-002"/);
  assert.match(html, /<details[^>]*data-doc-id="US-201"/);
});

test('renderPage carries a tree-errors banner when errors are present', async () => {
  const result = {
    tree: {
      manifest: { version: '2.0.0', projectName: 'X' },
      prd: null,
      tad: null,
      bs: null,
      requirements: [],
      userStories: [],
      tacs: [],
      adrs: [],
      fbsItems: [],
      testSuites: [],
      byId: new Map(),
      rawById: new Map(),
      brokenIds: new Set(),
      parentByChild: new Map(),
      childrenByParent: new Map(),
      fbsByAcId: new Map(),
      dependentsByFbsId: new Map(),
      tsByAcId: new Map(),
      tcsByAcId: new Map(),
      usByTacId: new Map(),
    },
    errors: [{ kind: 'brokenReference', message: 'gone', documentId: 'REQ-099' }],
  };
  const model = buildTreeModel(result);
  const html = renderPage(model);
  assert.match(html, /Tree has 1 error/);
  assert.match(html, /REQ-099/);
});

test('renderPage is deterministic across runs (D15)', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  assert.equal(renderPage(model), renderPage(model));
});

test('renderPage wraps the tabpanels in <div id="rcf-live-content"> (Phase 3.8 D13a)', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const html = renderPage(model);
  assert.match(html, /<div id="rcf-live-content">/);
  const wrapperIdx = html.indexOf('<div id="rcf-live-content">');
  const overviewIdx = html.indexOf('id="tab-overview"');
  const wrapperCloseIdx = html.lastIndexOf('</div>');
  const footerIdx = html.indexOf('<footer>');
  assert.ok(wrapperIdx > 0 && wrapperIdx < overviewIdx, 'wrapper opens before tabpanels');
  assert.ok(wrapperCloseIdx > overviewIdx && wrapperCloseIdx < footerIdx, 'wrapper closes before footer');
});

test('renderPage always injects the live-client script tag (Phase 3.8 D13a)', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const html = renderPage(model);
  assert.match(html, /<script src="\/live-client\.js" defer><\/script>/);
});

test('renderPage carries raw-json data-doc-id for every main doc (Phase 3.8 D13b)', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const html = renderPage(model);
  // Sample a handful of main-doc raw-json disclosures.
  for (const parent of ['PRD-001', 'REQ-002', 'US-201', 'TAD-001', 'FBS-003']) {
    assert.ok(
      html.includes(`data-doc-id="${parent}::raw"`),
      `missing raw-json data-doc-id for ${parent}`,
    );
  }
});

test('renderPage footer refers to live streaming rather than manual regenerate (Phase 3.8)', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const html = renderPage(model);
  assert.match(html, /stream to this tab automatically/);
  assert.doesNotMatch(html, /regenerate with/);
});

test('renderPage inline script is byte-identical to Phase 3.6 (guarded by layout regression)', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const html = renderPage(model);
  // The inline IIFE stays exactly as Phase 3.6 shipped it; the
  // layout-regression test asserts the full byte match against the
  // committed fixture. Here we spot-check its unchanged surface.
  assert.doesNotMatch(html, /__rcfWired/);
  assert.doesNotMatch(html, /window\.rcfPage/);
  assert.match(html, /function wireTabs\(\) \{[\s\S]*?btn\.addEventListener\('click', onTabClick\);[\s\S]*?\}/);
});

test('renderContent returns the innerHTML of the swap wrapper (no <div id="rcf-live-content"> tag)', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const content = renderContent(model);
  assert.doesNotMatch(content, /<div id="rcf-live-content"/);
  assert.doesNotMatch(content, /<script src=/);
  // Every tabpanel should still be present.
  for (const name of ['overview', 'requirements', 'architecture', 'build']) {
    assert.match(content, new RegExp(`id="tab-${name}"`));
  }
});

test('renderContent is the substring the wrapper contains, character for character', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const content = renderContent(model);
  const page = renderPage(model);
  assert.ok(page.includes(content), 'renderContent output must appear verbatim inside renderPage');
});

test('renderPage renders the build panel with buildOrder-sorted FBS slots (D15)', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const html = renderPage(model);
  // The dogfood tree has FBS-001..FBS-012 in buildOrder 1..12.
  const buildTabIdx = html.indexOf('id="tab-build"');
  const slice = html.slice(buildTabIdx);
  const fbs001Idx = slice.indexOf('href="#FBS-001"');
  const fbs002Idx = slice.indexOf('href="#FBS-002"');
  assert.ok(fbs001Idx > 0);
  assert.ok(fbs002Idx > 0);
  assert.ok(fbs001Idx < fbs002Idx);
});

test('renderPage still emits the PRD requirement link list from the computed childrenByParent map', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const html = renderPage(model);
  assert.match(html, /href="#REQ-001"/);
  assert.match(html, /href="#REQ-007"/);
});
