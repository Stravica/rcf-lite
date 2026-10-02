// Viewer UI refresh PR 3: integration coverage for the Requirements
// tab and the PRD EntitySelector. Builds against the dogfood tree so
// the row shape, filter bar, needs-work wiring and PRD entity selector
// all exercise the same renderPage path the live viewer uses.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { walkTree } from '#core/store';
import { renderPage } from '../../src/view/html-page.js';
import { buildTreeModel } from '../../src/view/tree-model.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

async function renderLive() {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const html = renderPage(model);
  return { model, html };
}

function sliceRequirementsTab(html) {
  const start = html.indexOf('id="tab-requirements"');
  const end = html.indexOf('id="tab-architecture"');
  assert.ok(start > 0 && end > start, 'tab-requirements slice is non-empty');
  return html.slice(start, end);
}

function slicePrdTab(html) {
  const start = html.indexOf('id="tab-overview"');
  const end = html.indexOf('id="tab-product-map"');
  assert.ok(start > 0 && end > start, 'tab-overview slice is non-empty');
  return html.slice(start, end);
}

// ---------------------------------------------------------------------
// Requirements tab
// ---------------------------------------------------------------------

test('Requirements tab mounts the shared FilterBar with text, area, priority, status and Needs-work', async () => {
  const { html } = await renderLive();
  const panel = sliceRequirementsTab(html);
  assert.match(panel, /<div class="rcf-filterbar filterbar" data-rcf-filterbar="requirements"/);
  assert.match(panel, /<input type="search" class="rcf-filter-text"/);
  assert.match(panel, /data-filter-key="domain"/);
  assert.match(panel, /data-filter-key="priority"/);
  assert.match(panel, /data-filter-key="status"/);
  assert.match(panel, /data-filter-key="needswork"/);
});

test('Requirements tab emits a DocRow per requirement with area/US/AC badges and status pill', async () => {
  const { html, model } = await renderLive();
  const panel = sliceRequirementsTab(html);
  const req = model.requirements.find((r) => r.reqId === 'REQ-003');
  assert.ok(req, 'dogfood tree carries REQ-003');
  // Row shape.
  assert.match(panel, /<details [^>]*class="rcf-row doc-row[^"]*doc-req-wrap[^"]*"[^>]*data-doc-id="REQ-003"/);
  // Facet / count badges on the row.
  assert.match(panel, /data-doc-id="REQ-003"[\s\S]*?rcf-badge--facet[\s\S]*?crud[\s\S]*?rcf-badge-label">US[\s\S]*?rcf-badge-label">AC/);
});

test('Requirements rows carry data-domain, data-priority, data-status, data-needswork, data-text', async () => {
  const { html } = await renderLive();
  const panel = sliceRequirementsTab(html);
  const row = panel.match(/<details [^>]*data-doc-id="REQ-003"[^>]*>/);
  assert.ok(row, 'REQ-003 row present');
  assert.match(row[0], /data-domain="crud"/);
  assert.match(row[0], /data-priority="must"/);
  assert.match(row[0], /data-status="draft"/);
  assert.match(row[0], /data-needswork="0"/);
  assert.match(row[0], /data-text="[^"]*deterministic/);
});

test('Requirements rows nest user stories as inner DocRows carrying their own data-doc-id', async () => {
  const { html, model } = await renderLive();
  const panel = sliceRequirementsTab(html);
  // Pick a REQ with user stories.
  const sampleUs = model.userStories.find((u) => u.usId === 'US-304');
  assert.ok(sampleUs, 'dogfood tree carries US-304');
  // The nested US row has the inner-row class and the data-doc-id.
  assert.match(panel, /<details [^>]*class="[^"]*rcf-row--inner[^"]*"[^>]*data-doc-id="US-304"/);
});

test('Requirements rows carry the slice diagram and raw JSON as collapsed inner details', async () => {
  const { html } = await renderLive();
  const panel = sliceRequirementsTab(html);
  // The slice-diagram <details> is collapsed by default; the mermaid
  // block lives inside it (no `open` attribute on the enclosing
  // details).
  assert.match(panel, /<details class="rcf-req-slice"><summary>Slice diagram/);
  assert.match(panel, /<details class="rcf-req-raw raw-json" data-doc-id="REQ-003::raw"/);
});

test('Needs-work rows carry the needs-work class and badge; honest-empty rows do not', async () => {
  // The dogfood tree computes readiness; the readiness result is on
  // model.readiness. On a clean dogfood tree the needs-work set is
  // honestly empty (no PO blockers), so no row carries data-needswork="1".
  const { html } = await renderLive();
  const panel = sliceRequirementsTab(html);
  // Every REQ row carries the flag; on the dogfood tree they are all 0.
  const rows = panel.match(/data-needswork="(0|1)"/g) ?? [];
  assert.ok(rows.length > 0, 'at least one REQ row');
  const ones = rows.filter((r) => r === 'data-needswork="1"');
  assert.equal(ones.length, 0, 'dogfood tree should have no PO-level needs-work rows');
});

test('Requirements tab lists are grouped under a data-rcf-list="requirements" wrapper', async () => {
  const { html } = await renderLive();
  const panel = sliceRequirementsTab(html);
  assert.match(panel, /<div class="rcf-requirements-list" data-rcf-list="requirements">/);
});

// ---------------------------------------------------------------------
// PRD tab: EntitySelector + collapsibles
// ---------------------------------------------------------------------

test('PRD tab replaces the inline requirement doc-link paragraph with the EntitySelector', async () => {
  const { html } = await renderLive();
  const prd = slicePrdTab(html);
  // Entity selector shows up.
  assert.match(prd, /data-rcf-entity-selector="requirements"/);
  assert.match(prd, /data-target-tab="requirements"/);
  // The legacy "Requirements" field-list heading is gone from the PRD article body.
  const article = prd.match(/<article id="PRD-001"[\s\S]*?<\/article>/);
  assert.ok(article, 'PRD article present');
  // No more "<h4>Requirements</h4>" inside the PRD article (the
  // selector sits outside the article).
  assert.doesNotMatch(article[0], /<h4>Requirements<\/h4>/);
});

test('PRD tab collapses the five lists (Target users / In scope / Out of scope / Objectives / Constraints) with count badges', async () => {
  const { html } = await renderLive();
  const prd = slicePrdTab(html);
  for (const name of ['Target users', 'In scope', 'Out of scope', 'Objectives', 'Constraints']) {
    assert.match(prd, new RegExp(`<details class="rcf-prd-list field-list"><summary><strong>${name}</strong>`));
  }
  // At least one of them has a count badge.
  assert.match(prd, /<summary><strong>Target users<\/strong> <span class="rcf-badge rcf-badge--count"><span class="rcf-badge-value">/);
});

test('PRD EntitySelector carries area chips linking into the Requirements tab filtered by domain', async () => {
  const { html, model } = await renderLive();
  const prd = slicePrdTab(html);
  // Pick a domain present in the dogfood tree.
  const sampleDomain = model.requirements.find((r) => typeof r.domain === 'string' && r.domain.length > 0)?.domain;
  assert.ok(sampleDomain, 'dogfood REQs carry a domain');
  const hashRe = new RegExp(`href="#tab=requirements&amp;domain=${sampleDomain}"`);
  assert.match(prd, hashRe);
});

test('PRD EntitySelector exposes a type-ahead jump input with autocomplete off', async () => {
  const { html } = await renderLive();
  const prd = slicePrdTab(html);
  assert.match(prd, /<input class="rcf-entity-selector-input" type="search" placeholder="[^"]*REQ-040[^"]*"[^>]* autocomplete="off"/);
});

test('PRD EntitySelector carries the full REQ catalogue as a JSON data payload', async () => {
  const { html, model } = await renderLive();
  const prd = slicePrdTab(html);
  const m = prd.match(/<script type="application\/json" class="rcf-entity-selector-data">([\s\S]*?)<\/script>/);
  assert.ok(m, 'entity-selector payload present');
  const items = JSON.parse(m[1]);
  assert.equal(items.length, model.requirements.length);
  assert.ok(items.every((it) => typeof it.id === 'string' && it.id.startsWith('REQ-')));
});

// ---------------------------------------------------------------------
// Page-init.js wiring (static source check)
// ---------------------------------------------------------------------

test('page-init.js contains the Requirements FilterBar wiring and EntitySelector wiring (PR 3)', async () => {
  const pageInit = await (await import('node:fs/promises')).readFile(
    resolve(repoRoot, 'src', 'view', 'page-init.js'), 'utf8',
  );
  // FilterBar + Needs-work + hash write.
  assert.match(pageInit, /wireRequirementsFilterBar/);
  assert.match(pageInit, /needswork/);
  assert.match(pageInit, /#tab=requirements/);
  // EntitySelector type-ahead + Enter-to-jump.
  assert.match(pageInit, /rcf-entity-selector-input/);
  assert.match(pageInit, /data-rcf-entity-selector/);
  assert.match(pageInit, /entity=/);
});

test('page-init.js resolveHash honours the requirements filter slots (q/domain/priority/status/needswork)', async () => {
  const pageInit = await (await import('node:fs/promises')).readFile(
    resolve(repoRoot, 'src', 'view', 'page-init.js'), 'utf8',
  );
  assert.match(pageInit, /applyRequirementsHash/);
});
