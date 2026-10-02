import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { walkTree } from '#core/store';
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

test('renderPage emits a six-tab layout with Readiness as tab 1 and Overview renamed PRD (AC-18001-1)', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const html = renderPage(model);
  for (const name of ['readiness', 'overview', 'requirements', 'architecture', 'build']) {
    assert.match(html, new RegExp(`data-tab="${name}"`));
    assert.match(html, new RegExp(`id="tab-${name}"`));
  }
  assert.match(html, /role="tablist"/);
  // Five single-word tab ids (product-map still escapes the `\w+` regex).
  const tabpanels = html.match(/<section id="tab-\w+" role="tabpanel"/g) ?? [];
  assert.equal(tabpanels.length, 5);
  // The former Overview label is now PRD (data-tab=overview preserved for
  // hash-anchor backwards compatibility; the heading inside the panel is
  // the former Overview content under the new label).
  assert.match(html, /data-tab="overview"[^>]*>PRD</);
  // Readiness button is the first tab button. The viewer UI refresh
  // PR 1 shell inserts tab buttons at a 6-space indent inside the
  // compact header; match the exact shape rather than the pre-PR-1
  // zero-indent form.
  const firstBtn = html.match(/<button type="button" role="tab" data-tab="(\w+)"/);
  assert.ok(firstBtn);
  assert.equal(firstBtn[1], 'readiness');
});

test('renderPage marks Readiness the default tabpanel and hides all other tabpanels (D12 + AC-18001-1)', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const html = renderPage(model);
  assert.match(html, /id="tab-readiness"[^>]*role="tabpanel"(?![^>]*hidden)/);
  assert.match(html, /id="tab-overview"[^>]*role="tabpanel"[^>]*hidden/);
  assert.match(html, /id="tab-requirements"[^>]*role="tabpanel"[^>]*hidden/);
  assert.match(html, /id="tab-architecture"[^>]*role="tabpanel"[^>]*hidden/);
  assert.match(html, /id="tab-build"[^>]*role="tabpanel"[^>]*hidden/);
});

test('renderPage references mermaid.min.js as a relative script tag (AC-202-1)', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const html = renderPage(model);
  // Viewer UI refresh PR 1 (Dex / wespa 2026-10-02 #263): relative so
  // the viewer works under the proxy mount at /rcf-viewer/.
  assert.match(html, /<script src="\.\/mermaid\.min\.js"/);
});

test('renderPage links external page-init.js and defers it (viewer UI refresh PR 1)', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const html = renderPage(model);
  // The single former inline <script> block moved to the ./page-init.js
  // asset: wespa's CSP pins inline scripts by hash and the viewer no
  // longer serves any. page-init.js carries the hashchange, role=tab
  // and mermaid.initialize wiring that the inline script used to.
  assert.match(html, /<script src="\.\/page-init\.js" defer><\/script>/);
  assert.doesNotMatch(html, /<script>\(function/);
  const pageInitPath = resolve(repoRoot, 'src', 'view', 'page-init.js');
  const pageInit = await (await import('node:fs/promises')).readFile(pageInitPath, 'utf8');
  assert.match(pageInit, /hashchange/);
  assert.match(pageInit, /role="tab"/);
  assert.match(pageInit, /mermaid\.initialize/);
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
  // Viewer UI refresh PR 1 renamed the footer to <footer class="app-footer">.
  const footerIdx = html.indexOf('<footer');
  assert.ok(wrapperIdx > 0 && wrapperIdx < overviewIdx, 'wrapper opens before tabpanels');
  assert.ok(wrapperCloseIdx > overviewIdx && wrapperCloseIdx < footerIdx, 'wrapper closes before footer');
});

test('renderPage always injects the live-client script tag (Phase 3.8 D13a)', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const html = renderPage(model);
  // Viewer UI refresh PR 1: relative path (Dex / wespa 2026-10-02 #263).
  assert.match(html, /<script src="\.\/live-client\.js" defer><\/script>/);
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

test('renderPage footer carries the shell live-update pill rather than manual regenerate (viewer UI refresh PR 1 follow-up)', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const html = renderPage(model);
  // The shell footer is one muted line: version, rcf-lite on GitHub,
  // RCF Lite docs, RCF method docs, live-update pill. The pre-PR-1
  // Phase 3.8 "stream to this tab automatically" paragraph is retired
  // in favour of the pill (connected / reconnecting / disconnected),
  // which live-client.js keeps in step with the EventSource state.
  assert.match(html, /<span id="rcf-conn-pill" class="live reconnecting"/);
  assert.match(html, /rcf-lite on GitHub/);
  assert.match(html, /RCF Lite docs/);
  assert.match(html, /RCF method docs/);
  assert.doesNotMatch(html, /regenerate with/);
  assert.doesNotMatch(html, /stream to this tab automatically/);
});

test('page-init.js wires the rcfPage.init entry and idempotence markers (viewer UI refresh PR 1)', async () => {
  // Phase 3.9 wired the promise the header comment made: window.rcfPage
  // exposes init() so the live client can re-invoke the tab and product
  // map wiring after every SSE innerHTML swap (P1-1). Viewer UI refresh
  // PR 1 moved the single inline script to ./page-init.js (Dex /
  // wespa 2026-10-02 #263; wespa pins inline scripts by CSP hash); we
  // check the same markers in the external asset.
  const pageInitPath = resolve(repoRoot, 'src', 'view', 'page-init.js');
  const pageInit = await (await import('node:fs/promises')).readFile(pageInitPath, 'utf8');
  assert.match(pageInit, /window\.rcfPage\s*=\s*window\.rcfPage\s*\|\|\s*\{\}/);
  assert.match(pageInit, /window\.rcfPage\.init\s*=\s*onReady/);
  assert.match(pageInit, /__rcfTabWired/);
  assert.match(pageInit, /__rcfPmWired/);
  assert.match(pageInit, /function wireTabs\(\) \{[\s\S]*?btn\.addEventListener\('click', onTabClick\);[\s\S]*?\}/);
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

test('renderPage renders the Build / Specs sub-tab with buildOrder-sorted FBS rows (PR 5)', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const html = renderPage(model);
  // The dogfood tree has FBS-001..FBS-012 in buildOrder 1..12. PR 5
  // dropped the old FBS-slots ordered list; the Build / Specs sub-tab
  // renders every spec as a DocRow with `data-doc-id="FBS-xxx"`, so
  // row order on the page is the authoritative order check.
  const buildTabIdx = html.indexOf('id="tab-build"');
  assert.ok(buildTabIdx > 0, 'tab-build panel must be in the output');
  const slice = html.slice(buildTabIdx);
  const fbs001Idx = slice.indexOf('data-doc-id="FBS-001"');
  const fbs002Idx = slice.indexOf('data-doc-id="FBS-002"');
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
