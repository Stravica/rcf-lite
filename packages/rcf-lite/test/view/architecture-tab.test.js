// Viewer UI refresh PR 4: integration coverage for the Architecture
// tab. Builds against the dogfood tree so the TAD section markup, the
// TAC / ADR DocRow lists and the two FilterBars all exercise the same
// renderPage path the live viewer uses.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { walkTree } from '#core/store';
import { renderPage } from '../../src/view/html-page.js';
import { buildTreeModel } from '../../src/view/tree-model.js';
import {
  renderTadSections,
  shortenDocId,
} from '../../src/view/doc-renderers/architecture.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

async function renderLive() {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const html = renderPage(model);
  return { model, html };
}

function sliceArchitectureTab(html) {
  const start = html.indexOf('id="tab-architecture"');
  const end = html.indexOf('id="tab-build"');
  assert.ok(start > 0 && end > start, 'tab-architecture slice is non-empty');
  return html.slice(start, end);
}

// ---------------------------------------------------------------------
// TAD sections (decision 5)
// ---------------------------------------------------------------------

test('Architecture tab renders the six canonical TAD sections in order', async () => {
  const { html } = await renderLive();
  const panel = sliceArchitectureTab(html);
  const matches = panel.match(/data-rcf-tad-section="([^"]+)"/g);
  assert.ok(matches, 'TAD section markers present');
  const keys = matches.map((m) => m.replace(/^data-rcf-tad-section="/, '').replace(/"$/, ''));
  assert.deepEqual(keys, [
    'systemOverview',
    'architecturePrinciples',
    'integrationArchitecture',
    'operationalConcerns',
    'dataArchitecture',
    'securityArchitecture',
  ]);
});

test('TAD section rows are shared DocRow collapsibles closed by default', async () => {
  const { html } = await renderLive();
  const panel = sliceArchitectureTab(html);
  const row = panel.match(/<details [^>]*class="rcf-row doc-row rcf-tad-section[^"]*"[^>]*data-rcf-tad-section="systemOverview"[^>]*>/);
  assert.ok(row, 'systemOverview is a rcf-row doc-row');
  assert.ok(!row[0].includes(' open'), 'systemOverview starts closed');
});

test('Present TAD section carries a one-line preview on its summary', async () => {
  const { html, model } = await renderLive();
  const panel = sliceArchitectureTab(html);
  const executive = model.tad?.systemOverview?.executiveSummary ?? '';
  assert.ok(executive.length > 0, 'dogfood TAD has an executive summary');
  // The preview truncates to ~110 chars; assert the leading sentence appears.
  const previewSample = executive.slice(0, 40);
  assert.ok(panel.includes(`<span class="rcf-tad-preview muted small">${previewSample.replace(/&/g, '&amp;')}`)
    || panel.includes(previewSample),
    'systemOverview preview includes the leading executive summary');
});

test('Absent TAD section reads "Nothing written yet" and names the authoring command', async () => {
  const { html } = await renderLive();
  const panel = sliceArchitectureTab(html);
  // The dogfood tree has dataArchitecture and securityArchitecture absent.
  const dataMatch = panel.match(/<details[^>]*data-rcf-tad-section="dataArchitecture"[^>]*data-empty="1"[\s\S]*?<\/details>/);
  assert.ok(dataMatch, 'dataArchitecture section rendered as empty');
  assert.match(dataMatch[0], /Nothing written yet/);
  assert.match(dataMatch[0], /rcf define update TAD-001 --set dataArchitecture\./);
  assert.match(dataMatch[0], /rcf-tad-empty-command/);
  const secMatch = panel.match(/<details[^>]*data-rcf-tad-section="securityArchitecture"[^>]*data-empty="1"[\s\S]*?<\/details>/);
  assert.ok(secMatch, 'securityArchitecture section rendered as empty');
  assert.match(secMatch[0], /rcf define update TAD-001 --set securityArchitecture\./);
});

test('Empty TAD section carries an "empty" facet badge in its meta slot', async () => {
  const { html } = await renderLive();
  const panel = sliceArchitectureTab(html);
  const dataMatch = panel.match(/<details[^>]*data-rcf-tad-section="dataArchitecture"[^>]*data-empty="1"[\s\S]*?<\/details>/);
  assert.ok(dataMatch, 'dataArchitecture section rendered');
  assert.match(dataMatch[0], /<span class="rcf-badge rcf-badge--facet"[^>]*><span class="rcf-badge-value">empty<\/span><\/span>/);
});

test('Architecture tab never names Readiness in TAD empty states', async () => {
  const { html } = await renderLive();
  const panel = sliceArchitectureTab(html);
  const dataMatch = panel.match(/<details[^>]*data-rcf-tad-section="dataArchitecture"[^>]*data-empty="1"[\s\S]*?<\/details>/);
  assert.ok(dataMatch, 'empty section found');
  assert.ok(!/readiness/i.test(dataMatch[0]), 'absent-section copy does not point at Readiness (amendment 12.4)');
});

test('renderTadSections handles an entirely missing TAD without throwing', () => {
  const out = renderTadSections(null);
  assert.match(out, /rcf-tad-sections/);
  const emptyMatches = out.match(/data-empty="1"/g) ?? [];
  assert.equal(emptyMatches.length, 6, 'every section renders as empty when TAD is null');
});

// ---------------------------------------------------------------------
// Page head
// ---------------------------------------------------------------------

test('Architecture page head carries the TAD id, status pill and component / decision tallies', async () => {
  const { html, model } = await renderLive();
  const panel = sliceArchitectureTab(html);
  assert.match(panel, /<div class="rcf-architecture-head">/);
  assert.match(panel, new RegExp(`<span class="rcf-architecture-head-id mono">${model.tad.tadId}</span>`));
  assert.match(panel, /rcf-pill--doc-status/);
  assert.match(panel, /\d+ components? - \d+ decisions?/);
});

// ---------------------------------------------------------------------
// Components panel (TAC)
// ---------------------------------------------------------------------

test('Components panel mounts a FilterBar with text + Status', async () => {
  const { html } = await renderLive();
  const panel = sliceArchitectureTab(html);
  assert.match(panel, /<div class="rcf-filterbar filterbar" data-rcf-filterbar="architecture-components"/);
  assert.match(panel, /<input type="search" class="rcf-filter-text"[^>]*placeholder="Filter components/);
  // The architecture-components filter must carry a status facet.
  const compBarMatch = panel.match(/data-rcf-filterbar="architecture-components"[\s\S]*?<\/div>/);
  assert.ok(compBarMatch, 'component filter bar region captured');
  assert.match(compBarMatch[0], /data-filter-key="status"/);
});

test('Each TAC renders as a shared DocRow with interface and dependency count badges plus a status pill', async () => {
  const { html, model } = await renderLive();
  const panel = sliceArchitectureTab(html);
  const tac = model.tacs.find((t) => t.tacId === 'TAC-001');
  assert.ok(tac, 'dogfood tree carries TAC-001');
  const row = panel.match(/<details [^>]*class="rcf-row doc-row doc-tac-wrap rcf-arch-row"[^>]*data-doc-id="TAC-001"[^>]*>/);
  assert.ok(row, 'TAC-001 row present as a DocRow');
  // Row attributes.
  assert.match(row[0], /data-status="draft"/);
  assert.match(row[0], /data-text="tac-001/);
  // Summary carries interfaces + deps badges.
  const summary = panel.match(/data-doc-id="TAC-001"[\s\S]*?<\/summary>/);
  assert.ok(summary, 'TAC-001 summary region captured');
  assert.match(summary[0], /rcf-badge-label">interfaces<\/span><span class="rcf-badge-value">\d+/);
  assert.match(summary[0], /rcf-badge-label">deps<\/span><span class="rcf-badge-value">\d+/);
  assert.match(summary[0], /rcf-pill rcf-pill--doc-status/);
});

test('Long TAC ids are shortened on the summary chip; the full id stays on data-doc-id', async () => {
  const { html, model } = await renderLive();
  const panel = sliceArchitectureTab(html);
  const long = model.tacs.find((t) => (t.tacId ?? '').split('-').length > 2);
  assert.ok(long, 'dogfood tree carries a long-id TAC');
  const rowRegex = new RegExp(`data-doc-id="${long.tacId}"[\\s\\S]*?</summary>`);
  const row = panel.match(rowRegex);
  assert.ok(row, 'long-id TAC summary captured');
  const expectedShort = shortenDocId(long.tacId);
  assert.ok(expectedShort.endsWith('...'), 'the chip is actually shortened');
  assert.match(row[0], new RegExp(`<span class="id">${expectedShort}</span>`));
});

// ---------------------------------------------------------------------
// Decisions panel (ADR)
// ---------------------------------------------------------------------

test('Decisions panel mounts a FilterBar and renders each ADR as a DocRow with a status pill', async () => {
  const { html, model } = await renderLive();
  const panel = sliceArchitectureTab(html);
  assert.match(panel, /<div class="rcf-filterbar filterbar" data-rcf-filterbar="architecture-decisions"/);
  const adr = model.adrs.find((a) => a.adrId === 'ADR-001');
  assert.ok(adr, 'dogfood tree carries ADR-001');
  const row = panel.match(/<details [^>]*class="rcf-row doc-row doc-adr-wrap rcf-arch-row"[^>]*data-doc-id="ADR-001"[^>]*>/);
  assert.ok(row, 'ADR-001 row present as a DocRow');
  assert.match(row[0], /data-status="accepted"/);
  const summary = panel.match(/data-doc-id="ADR-001"[\s\S]*?<\/summary>/);
  assert.ok(summary, 'ADR-001 summary captured');
  assert.match(summary[0], /rcf-pill rcf-pill--doc-status rcf-pill--accepted/);
});

test('ADR status pills reflect the full dogfood status vocabulary', async () => {
  const { html, model } = await renderLive();
  const panel = sliceArchitectureTab(html);
  const statuses = new Set((model.adrs ?? []).map((a) => a.status).filter(Boolean));
  for (const s of statuses) {
    const safe = s.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    assert.ok(panel.includes(`rcf-pill--${safe}`), `panel includes pill for status "${s}"`);
  }
});

// ---------------------------------------------------------------------
// Hash wiring
// ---------------------------------------------------------------------

test('page-init.js carries the architecture FilterBar wiring and the hash branch', () => {
  const scriptPath = resolve(here, '..', '..', 'src', 'view', 'page-init.js');
  const src = readFileSync(scriptPath, 'utf8');
  assert.match(src, /wireArchitectureFilterBars\(\)/);
  assert.match(src, /architecture-components/);
  assert.match(src, /architecture-decisions/);
  assert.match(src, /applyArchitectureHash/);
  assert.match(src, /openArchitectureSections/);
  assert.match(src, /tab === 'architecture'/);
});

// ---------------------------------------------------------------------
// shortenDocId unit
// ---------------------------------------------------------------------

test('shortenDocId keeps short ids, trims long ones to KIND-NNN...', () => {
  assert.equal(shortenDocId('TAC-001'), 'TAC-001');
  assert.equal(shortenDocId('ADR-010'), 'ADR-010');
  assert.equal(shortenDocId('TAC-3701-edge-cloudflare-rate-limiting-manifest-schema'), 'TAC-3701...');
  assert.equal(shortenDocId(''), '');
  assert.equal(shortenDocId(undefined), '');
});
