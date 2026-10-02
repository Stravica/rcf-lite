// Assembles index.html from doc-renderer output and the per-REQ Mermaid
// subdiagrams. Phase 3.2 introduced the four-tab layout (Overview,
// Requirements, Architecture, Build sequence) plus nested `<details>`
// drill-down under Requirements. Phase 3.6 dropped the top-of-overview
// diagram - it was redundant with the PRD body's requirementIds list
// and unwieldy past ~15 REQs. Overview tab now renders the PRD body
// only. If JS is unavailable, every tabpanel is visible in DOM order (D12).
//
// Phase 3.8 wraps the swappable tree content in a stable
// `<div id="rcf-live-content">` (D13a) and always injects the live
// client script before `</body>`. The tab init routine is exposed as
// `window.rcfPage.init()` so the live client can re-invoke it after
// every SSE innerHTML swap.
//
// Viewer UI refresh PR 1 (w-2026-10-02-dave-010, Dex / wespa relay
// f0384046 on 2026-10-02):
//   - compact Stravica-brand shell: data-theme light|dark|auto on
//     <html>, data-embed=1 suppresses the brand block and the footer
//     and keeps the tab nav sticky, viewport-height scroll box owned
//     by <main>, never scrolls horizontally.
//   - asset and SSE references are RELATIVE (./live-client.js,
//     ./page-init.js, ./style.css, ./mermaid.min.js, ./product-map/,
//     ./events, ./scope.json) so the wespa reverse-proxy mount under
//     /rcf-viewer/ keeps working without rewrites (issue #263).
//   - the single former inline script lives at ./page-init.js;
//     wespa's CSP pins inline scripts by hash and we no longer have
//     any. page-init.js carries the theme/embed boot, origin-checked
//     postMessage listener for { type:"rcf-view-theme", theme } and
//     the Router (#tab=&sub=&entity=, bare #REQ-002, host query
//     preserved on every write).

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  renderAdr,
  renderBuildPageHead,
  renderBuildStats,
  renderPrd,
  renderSpecBody,
  renderTac,
  renderTadSections,
  renderUserStory,
  shortenDocId,
} from './doc-renderers/index.js';
import { detailsWrap, escapeHtml } from './doc-renderers/helpers.js';
import { computeQueue } from '../build/queue.js';
import { allRequirementSubdiagrams } from './mermaid-diagram.js';
import { renderProductMapPanel } from './product-map.js';
import { renderReadinessPanel } from './readiness.js';
import { renderToastContainer } from './components/toast.js';
import { renderDocRow } from './components/doc-row.js';
import { renderFilterBar } from './components/filter-bar.js';
import { renderBadge } from './components/badge.js';
import { pill } from './components/pill.js';
import { renderEmptyState } from './components/empty-state.js';
import { renderEntitySelector } from './components/entity-selector.js';
import { renderSubTabStrip } from './components/sub-tab-strip.js';
import { buildDagLayout, buildDagInspectorPayload, renderBuildDag } from './build-dag.js';
import { computeReqNeedsWorkIds, needsWorkReasonFor } from './needs-work.js';
import { renderLookupModal, renderSearchButton } from './view-index.js';

// Umbrella version stamped at module load (same pattern as src/ruleset/index.js).
// Used by the shell footer so the muted "RCF Lite X.Y.Z" line tracks the
// installed package without a build step.
const pkgJsonPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
const RCF_LITE_VERSION = JSON.parse(readFileSync(pkgJsonPath, 'utf8')).version;

// Inline SVG favicon: the Stravica kit mark (deep-navy tile with the
// ribbon symbol in Stravica blue), taken from the estate brand kit at
// public/brand/assets/icons/favicon.svg so the review surface shares
// identity with stravica.ai. Delivered as a data URL so no separate file has to ship.
const FAVICON_HREF =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64' width='64' height='64' role='img'%3E%3Ctitle%3EStravica favicon%3C/title%3E%3Cdesc%3E%3C/desc%3E%3Crect x='0' y='0' width='64' height='64' rx='14' fill='%23080F19'/%3E%3Cg fill='%237295FF'%3E%3Cpath d='M38 9L17 21V32L38 20Z'/%3E%3Cpath d='M30 27L46 36V46L30 37L23 33Z'/%3E%3Cpath d='M46 46L25 58V47L37 40Z'/%3E%3C/g%3E%3C/svg%3E";

const LIVE_WRAPPER_OPEN = '<div id="rcf-live-content">';
const LIVE_WRAPPER_CLOSE = '</div>';

/**
 * Render the complete index.html string. Phase 3.8: always includes the
 * live-content wrapper and the live-client script tag.
 *
 * @param {import('./tree-model.js').BuiltTreeModel} model
 * @returns {string}
 */
export function renderPage(model) {
  const header = resolveProductHeader(model);
  const projectName = header.projectName ?? 'RCF project';
  const contentHtml = renderContent(model);

  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(projectName)} - RCF review surface</title>
  <link rel="icon" type="image/svg+xml" href="${FAVICON_HREF}">
  <link rel="stylesheet" href="./style.css">
  <noscript>
    <style>
      /* Progressive enhancement per D12: no JS -> every tabpanel is
         visible, stacked in DOM order. The tab bar becomes visual chrome
         only (buttons do nothing) so we hide it. */
      nav.tabs { display: none !important; }
      section[role="tabpanel"][hidden] { display: block !important; }
    </style>
  </noscript>
</head>
<body>
  <header class="app-header">
    <div class="bar">
      <div class="brand" title="Review surface">
        <svg class="mark" aria-hidden="true" viewBox="0 0 64 64" width="18" height="18"><rect x="0" y="0" width="64" height="64" rx="14" fill="#080F19"/><g fill="#7295FF"><path d="M38 9L17 21V32L38 20Z"/><path d="M30 27L46 36V46L30 37L23 33Z"/><path d="M46 46L25 58V47L37 40Z"/></g></svg>
      </div>
      ${renderProductBlock(header)}
      <nav class="tabs" role="tablist" aria-label="Document sections">
        <button type="button" role="tab" data-tab="readiness" aria-selected="true" aria-controls="tab-readiness">Readiness</button>
        <button type="button" role="tab" data-tab="overview" aria-selected="false" aria-controls="tab-overview">PRD</button>
        <button type="button" role="tab" data-tab="product-map" aria-selected="false" aria-controls="tab-product-map">Product Map</button>
        <button type="button" role="tab" data-tab="requirements" aria-selected="false" aria-controls="tab-requirements">Requirements</button>
        <button type="button" role="tab" data-tab="architecture" aria-selected="false" aria-controls="tab-architecture">Architecture</button>
        <button type="button" role="tab" data-tab="build" aria-selected="false" aria-controls="tab-build">Build</button>
      </nav>
      <div class="tools" aria-label="Viewer tools">
        ${renderSearchButton()}
      </div>
    </div>
  </header>
  <main>
    ${LIVE_WRAPPER_OPEN}
    ${contentHtml}
    ${LIVE_WRAPPER_CLOSE}
  </main>
  <footer class="app-footer">
    <span class="ver">RCF Lite ${escapeHtml(RCF_LITE_VERSION)}</span>
    <span class="sep" aria-hidden="true">&middot;</span>
    <a href="https://github.com/Stravica/rcf-lite" target="_blank" rel="noopener">rcf-lite on GitHub</a>
    <span class="sep" aria-hidden="true">&middot;</span>
    <a href="https://stravica.ai/docs/rcf/" target="_blank" rel="noopener">RCF Lite docs</a>
    <span class="sep" aria-hidden="true">&middot;</span>
    <a href="https://stravica.ai/rcf-methodology/" target="_blank" rel="noopener">RCF method docs</a>
    <span id="rcf-conn-pill" class="live reconnecting" role="status" aria-live="polite" title="Connecting to view server...">
      <span class="dot" aria-hidden="true"></span>
      <span class="label">Connecting&hellip;</span>
    </span>
  </footer>
  ${renderToastContainer()}
  ${renderLookupModal()}
  <script src="./mermaid.min.js"></script>
  <script src="./page-init.js" defer></script>
  <script src="./live-client.js" defer></script>
</body>
</html>
`;
}

/**
 * Render the innerHTML of the swappable `<div id="rcf-live-content">`
 * container - i.e. everything inside `<main>`. This is the payload the
 * SSE `tree-update` event carries; the live client replaces the
 * wrapper's innerHTML with this string.
 *
 * @param {import('./tree-model.js').BuiltTreeModel} model
 * @returns {string}
 */
export function renderContent(model) {
  const subdiagrams = allRequirementSubdiagrams(model);
  const needsWorkIds = computeReqNeedsWorkIds(model.readiness);

  const prdSection = model.prd
    ? renderPrd(model.prd, {
      raw: model.rawById.get(model.prd.prdId),
      errors: model.errorsById.get(model.prd.prdId),
      requirementIds: model.childrenByParent.get(model.prd.prdId) ?? [],
      suppressRequirementList: true,
      collapsibleLists: true,
    })
    : '<p><em>No PRD on disk.</em></p>';

  const prdSelector = renderPrdRequirementSelector(model);
  const requirementsPanel = renderRequirementsPanel(model, subdiagrams, needsWorkIds);
  const architecturePanel = renderArchitecturePanel(model);
  const buildPanel = renderBuildPanel(model);
  const productMapPanel = renderProductMapPanel(model);
  const readinessPanel = renderReadinessPanel(model.readiness ?? null, {
    profile: model.profileText ?? null,
    freezeRecord: model.freezeRecord ?? null,
  });

  const errorBanner = renderErrorBanner(model.errors ?? []);

  return `${errorBanner}
    <section id="tab-readiness" role="tabpanel" aria-labelledby="tab-readiness-button">
      <h2 class="tab-heading">Readiness</h2>
      ${readinessPanel}
    </section>
    <section id="tab-overview" role="tabpanel" aria-labelledby="tab-overview-button" hidden>
      <h2 class="tab-heading">PRD</h2>
      <div class="prd-body">
        ${prdSection}
        ${prdSelector}
      </div>
    </section>
    <section id="tab-product-map" role="tabpanel" hidden>
      <h2 class="tab-heading">Product Map</h2>
      ${productMapPanel}
    </section>
    <section id="tab-requirements" role="tabpanel" hidden>
      <h2 class="tab-heading">Requirements</h2>
      ${requirementsPanel}
    </section>
    <section id="tab-architecture" role="tabpanel" hidden>
      <h2 class="tab-heading">Architecture</h2>
      ${architecturePanel}
    </section>
    <section id="tab-build" role="tabpanel" hidden>
      <h2 class="tab-heading">Build</h2>
      ${buildPanel}
    </section>`;
}

/**
 * Viewer UI refresh PR 3 (decision 2, decision 3, decision 14): the
 * Requirements tab renders every REQ as a shared DocRow carrying
 * area / US count / AC count badges and a status pill. The FilterBar
 * above drives text / area / priority / status / Needs-work filtering;
 * state is wired to the URL hash in page-init.js so a filtered view
 * is a link. Each row stays closed by default; when opened it shows
 * the renderReq body (description, rationale, tags), a nested row of
 * user stories (with AC counts), and the slice diagram + raw JSON as
 * their own collapsed inner details so the first-paint stays cheap.
 *
 * `#entity=US-304` resolves to REQ-003 and US-304: the hash router
 * opens every ancestor <details> and the US row's data-doc-id anchor
 * is the one the current router already walks (decision 11, PR 1).
 *
 * @param {import('./tree-model.js').BuiltTreeModel} model
 * @param {Map<string, string>} subdiagrams - REQ id -> Mermaid source
 * @param {Set<string>} needsWorkIds - REQ ids still needing PO work
 */
function renderRequirementsPanel(model, subdiagrams, needsWorkIds) {
  if (model.requirements.length === 0 && model.userStories.length === 0) {
    return renderEmptyState({
      title: 'No requirements on disk',
      hint: 'Add requirements under rcf/requirements/ and the viewer picks them up on the next walk.',
    });
  }
  const areaCounts = countBy(model.requirements, (r) => normaliseFacet(r.domain));
  const priorityCounts = countBy(model.requirements, (r) => normaliseFacet(r.priority));
  const statusCounts = countBy(model.requirements, (r) => normaliseFacet(r.status));

  const filterBar = renderFilterBar({
    hashKey: 'requirements',
    placeholder: 'Filter by id, title or text',
    selects: [
      {
        key: 'domain',
        label: 'Area',
        options: [{ value: '', label: 'All areas' }, ...facetOptions(areaCounts)],
      },
      {
        key: 'priority',
        label: 'Priority',
        options: [{ value: '', label: 'Any priority' }, ...facetOptions(priorityCounts)],
      },
      {
        key: 'status',
        label: 'Status',
        options: [{ value: '', label: 'Any status' }, ...facetOptions(statusCounts)],
      },
    ],
    toggles: [
      { key: 'needswork', label: `Needs work (${needsWorkIds.size})` },
    ],
    count: { visible: model.requirements.length, total: model.requirements.length },
    showExpandAll: true,
  });

  const reqRows = model.requirements.map((r) => renderRequirementRow(r, model, subdiagrams, needsWorkIds)).join('\n');

  const orphanUs = model.userStories.filter((u) => !u.reqId || !model.requirements.some((r) => r.reqId === u.reqId));
  const orphanBlock = orphanUs.length > 0
    ? `<section class="orphan-us"><h3 class="group-heading">Orphan user stories</h3>${orphanUs.map((u) => detailsWrap({
      id: u.usId,
      summary: `${u.usId} - ${u.title ?? ''}`,
      className: 'doc-us-wrap',
      status: u.status,
      body: renderUserStory(u, {
        raw: model.rawById.get(u.usId),
        errors: model.errorsById.get(u.usId),
        fbsByAcId: model.fbsByAcId,
      }),
    })).join('\n')}</section>`
    : '';

  return `${filterBar}
<div class="rcf-requirements-list" data-rcf-list="requirements">
${reqRows}
</div>
${orphanBlock}`;
}

function renderRequirementRow(req, model, subdiagrams, needsWorkIds) {
  const stories = model.storiesByReqId.get(req.reqId) ?? [];
  const acCount = stories.reduce((n, u) => n + (u.acceptanceCriteria?.length ?? 0), 0);
  const area = normaliseFacet(req.domain);
  const priority = normaliseFacet(req.priority);
  const status = normaliseFacet(req.status);
  const needsWork = needsWorkIds.has(req.reqId);
  const needsWorkReason = needsWork ? (needsWorkReasonFor(model.readiness, req.reqId) ?? 'needs engineer-ready detail') : '';

  const metaParts = [];
  if (area) metaParts.push(renderBadge({ value: area, variant: 'facet', title: 'Area' }));
  metaParts.push(renderBadge({ value: stories.length, label: 'US', variant: 'count', title: 'User stories' }));
  metaParts.push(renderBadge({ value: acCount, label: 'AC', variant: 'count', title: 'Acceptance criteria' }));
  if (status) metaParts.push(pill({ value: status, variant: 'doc-status' }));
  if (needsWork) metaParts.push(renderBadge({ value: 'needs work', variant: 'accent', title: needsWorkReason }));
  const meta = metaParts.join(' ');

  const usRows = stories.map((u) => renderUserStoryInnerRow(u, model)).join('\n');
  const storiesBlock = stories.length > 0
    ? `<section class="rcf-req-stories"><h4>User stories (${stories.length})</h4>${usRows}</section>`
    : '<p class="muted"><em>No user stories under this requirement yet.</em></p>';

  const description = typeof req.description === 'string' && req.description.length > 0
    ? `<p class="rcf-req-description">${escapeHtml(req.description)}</p>`
    : '';
  const rationale = typeof req.rationale === 'string' && req.rationale.length > 0
    ? `<p class="rcf-req-rationale muted"><strong>Why:</strong> ${escapeHtml(req.rationale)}</p>`
    : '';
  const tags = Array.isArray(req.tags) && req.tags.length > 0
    ? `<div class="rcf-req-tags">${req.tags.map((t) => renderBadge({ value: t, variant: 'facet' })).join(' ')}</div>`
    : '';
  const needsWorkLine = needsWork
    ? `<p class="rcf-req-needswork"><strong>Needs work:</strong> ${escapeHtml(needsWorkReason)}</p>`
    : '';

  const subdiagram = subdiagrams.get(req.reqId);
  const sliceDetails = subdiagram
    ? `<details class="rcf-req-slice"><summary>Slice diagram <span class="muted small">(REQ, stories, criteria and the FBS that deliver them)</span></summary><div class="rcf-req-slice-body"><pre class="mermaid">${escapeHtml(subdiagram)}</pre></div></details>`
    : '';

  const rawJson = model.rawById.get(req.reqId) ?? JSON.stringify(req, null, 2);
  const rawDetails = `<details class="rcf-req-raw raw-json" data-doc-id="${escapeHtml(req.reqId)}::raw"><summary class="muted small">Raw JSON</summary><pre>${escapeHtml(rawJson)}</pre></details>`;

  const body = `${needsWorkLine}${description}${rationale}${tags}${storiesBlock}${sliceDetails}${rawDetails}`;

  const extraClasses = ['doc-req-wrap'];
  if (needsWork) extraClasses.push('needs-work');
  const row = renderDocRow({
    id: req.reqId,
    title: req.title ?? '',
    body,
    meta,
    className: extraClasses.join(' '),
  });

  // Attach the filter-facet data attributes to the <details> opening
  // tag so page-init.js can hide / show rows without touching the body.
  const dataAttrs = ` data-domain="${escapeHtml(area)}" data-priority="${escapeHtml(priority)}" data-status="${escapeHtml(status)}" data-needswork="${needsWork ? '1' : '0'}" data-text="${escapeHtml(buildFilterText(req, stories))}"`;
  return row.replace(/^<details /, `<details${dataAttrs} `);
}

function renderUserStoryInnerRow(us, model) {
  const acCount = us.acceptanceCriteria?.length ?? 0;
  const status = normaliseFacet(us.status);
  const metaParts = [renderBadge({ value: acCount, label: 'AC', variant: 'count', title: 'Acceptance criteria' })];
  if (status) metaParts.push(pill({ value: status, variant: 'doc-status' }));
  const body = renderUserStory(us, {
    raw: model.rawById.get(us.usId),
    errors: model.errorsById.get(us.usId),
    fbsByAcId: model.fbsByAcId,
  });
  return renderDocRow({
    id: us.usId,
    title: us.title ?? '',
    body,
    meta: metaParts.join(' '),
    className: 'doc-us-wrap rcf-row--inner',
  });
}

function buildFilterText(req, stories) {
  const parts = [req.reqId, req.title, req.description, req.rationale, req.domain, req.priority, req.status];
  if (Array.isArray(req.tags)) parts.push(req.tags.join(' '));
  for (const u of stories) {
    parts.push(u.usId, u.title, u.asA, u.iWant, u.soThat);
  }
  return parts.filter((v) => typeof v === 'string' && v.length > 0).join(' ').toLowerCase();
}

function normaliseFacet(v) {
  if (typeof v !== 'string') return '';
  return v.trim();
}

function countBy(items, keyFn) {
  const out = new Map();
  for (const it of items) {
    const k = keyFn(it);
    if (!k) continue;
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

function facetOptions(counts) {
  const entries = [...counts.entries()];
  entries.sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]));
  return entries.map(([value, count]) => ({ value, label: `${value} (${count})` }));
}

/**
 * Viewer UI refresh PR 3 (decision 4): the PRD tab replaces the 109
 * inline requirement links with an EntitySelector. Area chips deep-link
 * into the Requirements tab filtered by domain. The jump input picks
 * one REQ by id or title and writes `#tab=requirements&entity=<id>`.
 *
 * @param {import('./tree-model.js').BuiltTreeModel} model
 */
function renderPrdRequirementSelector(model) {
  const reqs = model.requirements ?? [];
  if (reqs.length === 0) return '';
  const items = reqs.map((r) => ({
    id: r.reqId,
    title: r.title ?? '',
    facet: normaliseFacet(r.domain),
  }));
  const areaCounts = countBy(reqs, (r) => normaliseFacet(r.domain));
  const facets = [...areaCounts.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .map(([value, count]) => ({ value, count }));
  const acTotal = (model.userStories ?? []).reduce((n, u) => n + (u.acceptanceCriteria?.length ?? 0), 0);
  const totalLabel = `${reqs.length} requirements in ${facets.length} area${facets.length === 1 ? '' : 's'}, ${model.userStories.length} stories, ${acTotal} acceptance criteria`;
  const selector = renderEntitySelector({
    hashKey: 'requirements',
    targetTab: 'requirements',
    facetKey: 'domain',
    items,
    facets,
    totalLabel,
    placeholder: `Jump to a requirement by id or title (e.g. REQ-040 or 'readiness')`,
    chipsLabel: 'By area (click to open the Requirements tab filtered):',
  });
  return `<section class="rcf-prd-requirements" id="prd-requirements">
    <div class="rcf-prd-requirements-head">
      <h3>Requirements</h3>
      <a class="rcf-prd-requirements-open" href="#tab=requirements">Open the Requirements tab</a>
    </div>
    ${selector}
  </section>`;
}

/**
 * Viewer UI refresh PR 4 (w-2026-10-02-dave-010 decisions 5 and 14,
 * design doc section 5.5). The Architecture tab renders:
 *   1. A compact page-head carrying the TAD id, its status pill and
 *      the TAC / ADR tallies.
 *   2. The TAD as six collapsed sections with one-line previews; an
 *      absent section reads "Nothing written yet" and names the
 *      `rcf define update TAD-001 --set <section>.<field>="..."` call
 *      that authors it (decision 5).
 *   3. Components (TAC) as a FilterBar + a shared DocRow list; rows
 *      carry interface and dependency counts and a status pill. Long
 *      ids are shortened on the summary; the full id stays on
 *      data-doc-id and the title.
 *   4. Architectural decisions (ADR) as a FilterBar + a shared DocRow
 *      list; rows carry a status pill. Long ids shortened the same way.
 *
 * The tab never points at Readiness (amendment 12.4) - absence of
 * content is handled inside this tab's own register.
 */
function renderArchitecturePanel(model) {
  const pageHead = renderArchitecturePageHead(model);
  const tadSection = model.tad
    ? renderTadSections(model.tad)
    : renderEmptyState({
      title: 'No TAD on disk',
      hint: 'Add rcf/tad.json and the viewer picks it up on the next walk.',
    });

  const tacPanel = renderComponentsPanel(model);
  const adrPanel = renderDecisionsPanel(model);

  // Raw JSON for the whole TAD stays reachable but out of the first
  // paint - the design doc deliberately drops "the long prose dump".
  const rawTadDisclosure = model.tad
    ? `<details class="rcf-tad-raw" data-doc-id="${escapeHtml(model.tad.tadId)}::raw"><summary class="muted small">Raw TAD JSON</summary><pre>${escapeHtml(model.rawById.get(model.tad.tadId) ?? JSON.stringify(model.tad, null, 2))}</pre></details>`
    : '';

  // Hidden anchors so #TAD-001 / #entity=TAD-001 still land on this tab.
  const tadAnchor = model.tad
    ? `<span class="rcf-tad-anchor" data-doc-id="${escapeHtml(model.tad.tadId)}" aria-hidden="true"></span>`
    : '';

  return `
${tadAnchor}
${pageHead}
<section class="rcf-architecture-tad" aria-labelledby="arch-tad-heading">
  <h3 id="arch-tad-heading" class="group-heading rcf-tad-group-heading">Technical architecture (TAD)</h3>
  ${tadSection}
  ${rawTadDisclosure}
</section>
${tacPanel}
${adrPanel}
`;
}

function renderArchitecturePageHead(model) {
  if (!model.tad) {
    return `<div class="rcf-architecture-head"><h3 class="rcf-architecture-head-title">Architecture</h3></div>`;
  }
  const status = normaliseFacet(model.tad.status);
  const statusPill = status ? pill({ value: status, variant: 'doc-status' }) : '';
  const tacCount = (model.tacs ?? []).length;
  const adrCount = (model.adrs ?? []).length;
  return `<div class="rcf-architecture-head">
    <span class="rcf-architecture-head-id mono">${escapeHtml(model.tad.tadId)}</span>
    ${statusPill}
    <span class="muted small">${tacCount} component${tacCount === 1 ? '' : 's'} - ${adrCount} decision${adrCount === 1 ? '' : 's'}</span>
  </div>`;
}

function renderComponentsPanel(model) {
  const tacs = model.tacs ?? [];
  const statusCounts = countBy(tacs, (t) => normaliseFacet(t.status));
  const filterBar = renderFilterBar({
    hashKey: 'architecture-components',
    placeholder: 'Filter components by id or text',
    selects: [
      {
        key: 'status',
        label: 'Status',
        options: [{ value: '', label: 'Any status' }, ...facetOptions(statusCounts)],
      },
    ],
    count: { visible: tacs.length, total: tacs.length },
    showExpandAll: true,
  });

  const rows = tacs.map((t) => renderTacRow(t, model)).join('\n');
  const emptyMessage = tacs.length === 0
    ? renderEmptyState({ title: 'No TAC components on disk', hint: 'Add rcf/tacs/<file>.json files and the viewer picks them up.' })
    : '';

  return `<section class="rcf-architecture-components" aria-labelledby="arch-tac-heading">
  <h3 id="arch-tac-heading" class="group-heading">Components</h3>
  ${filterBar}
  <div class="rcf-tac-list" data-rcf-list="architecture-components">
    ${rows}
  </div>
  ${emptyMessage}
</section>`;
}

function renderDecisionsPanel(model) {
  const adrs = model.adrs ?? [];
  const statusCounts = countBy(adrs, (a) => normaliseFacet(a.status));
  const filterBar = renderFilterBar({
    hashKey: 'architecture-decisions',
    placeholder: 'Filter decisions by id or text',
    selects: [
      {
        key: 'status',
        label: 'Status',
        options: [{ value: '', label: 'Any status' }, ...facetOptions(statusCounts)],
      },
    ],
    count: { visible: adrs.length, total: adrs.length },
    showExpandAll: true,
  });

  const rows = adrs.map((a) => renderAdrRow(a, model)).join('\n');
  const emptyMessage = adrs.length === 0
    ? renderEmptyState({ title: 'No architectural decisions on disk', hint: 'Add rcf/adrs/<file>.json files and the viewer picks them up.' })
    : '';

  return `<section class="rcf-architecture-decisions" aria-labelledby="arch-adr-heading">
  <h3 id="arch-adr-heading" class="group-heading">Architectural decisions</h3>
  ${filterBar}
  <div class="rcf-adr-list" data-rcf-list="architecture-decisions">
    ${rows}
  </div>
  ${emptyMessage}
</section>`;
}

function renderTacRow(tac, model) {
  const id = tac.tacId ?? 'TAC';
  const displayId = shortenDocId(id);
  const title = tac.name ?? '';
  const interfaceCount = Array.isArray(tac.interfaces) ? tac.interfaces.length : 0;
  const depCount = Array.isArray(tac.dependencies) ? tac.dependencies.length : 0;
  const status = normaliseFacet(tac.status);
  const metaParts = [
    renderBadge({ value: interfaceCount, label: 'interfaces', variant: 'count', title: 'Interface count' }),
    renderBadge({ value: depCount, label: 'deps', variant: 'count', title: 'Dependency count' }),
  ];
  if (status) metaParts.push(pill({ value: status, variant: 'doc-status' }));
  const meta = metaParts.join(' ');

  const body = renderTac(tac, {
    raw: model.rawById.get(id),
    errors: model.errorsById.get(id),
  });
  const row = renderDocRow({
    id: displayId,
    title,
    body,
    meta,
    className: 'doc-tac-wrap rcf-arch-row',
    dataDocId: id,
  });
  const dataAttrs = ` data-status="${escapeHtml(status)}" data-text="${escapeHtml(buildTacFilterText(tac))}" title="${escapeHtml(id)}"`;
  return row.replace(/^<details /, `<details${dataAttrs} `);
}

function renderAdrRow(adr, model) {
  const id = adr.adrId ?? 'ADR';
  const displayId = shortenDocId(id);
  const title = adr.title ?? '';
  const status = normaliseFacet(adr.status);
  const metaParts = [];
  if (status) metaParts.push(pill({ value: status, variant: 'doc-status' }));
  const meta = metaParts.join(' ');

  const body = renderAdr(adr, {
    raw: model.rawById.get(id),
    errors: model.errorsById.get(id),
  });
  const row = renderDocRow({
    id: displayId,
    title,
    body,
    meta,
    className: 'doc-adr-wrap rcf-arch-row',
    dataDocId: id,
  });
  const dataAttrs = ` data-status="${escapeHtml(status)}" data-text="${escapeHtml(buildAdrFilterText(adr))}" title="${escapeHtml(id)}"`;
  return row.replace(/^<details /, `<details${dataAttrs} `);
}

function buildTacFilterText(tac) {
  const parts = [tac.tacId, tac.name, tac.purpose, tac.internalStructure, tac.notes, tac.tradeoffs];
  if (Array.isArray(tac.responsibilities)) parts.push(tac.responsibilities.join(' '));
  if (Array.isArray(tac.interfaces)) {
    for (const i of tac.interfaces) parts.push(i?.name, i?.description);
  }
  if (Array.isArray(tac.dependencies)) {
    for (const d of tac.dependencies) parts.push(d?.name, d?.description);
  }
  return parts.filter((v) => typeof v === 'string' && v.length > 0).join(' ').toLowerCase();
}

function buildAdrFilterText(adr) {
  const parts = [adr.adrId, adr.title, adr.status, adr.context, adr.decision, adr.consequences];
  if (Array.isArray(adr.alternativesConsidered)) {
    for (const a of adr.alternativesConsidered) parts.push(a?.name, a?.summary, a?.reasonNotChosen);
  }
  return parts.filter((v) => typeof v === 'string' && v.length > 0).join(' ').toLowerCase();
}

/**
 * Viewer UI refresh PR 5 (w-2026-10-02-dave-010 decisions 2, 3, 6, 12,
 * 14; design doc section 5.6). The Build tab renders:
 *
 *   1. BuildStats card: totals from `computeQueue` (items, verified,
 *      complete, inProgress, notStarted, buildable now). "Buildable now"
 *      equals `queue.totals.actionable` - the authoritative state the
 *      queue computes from `dependsOnFbsIds` and `executionStatus`.
 *   2. SubTabStrip Specs | DAG (decision 6 + decision 12). The DAG
 *      sub-panel (PR 6) lays FBS by `dependsOnFbsIds` depth with
 *      click-to-highlight closure, an inspector and the unconnected
 *      lane; `renderBuildDag` emits the full panel HTML string from
 *      `buildDagLayout(fbsItems, buildableIds)`.
 *   3. Specs sub-tab: FilterBar (text, status, area, size, Buildable-now
 *      toggle) over a shared DocRow list; row meta carries order, AC
 *      count, deps count, size, buildable pill, status.
 *   4. Expanded Spec row body: summary, approach, AC and dep links,
 *      deliverables, context links, Show in the DAG.
 *
 * Dropped from the old Build sequence tab: the FBS slots block (the
 * 87-row list was repetition of the specs below) and the Test suites
 * section (suites stay reachable through AC links and PR 7's ID
 * lookup).
 *
 * @param {import('./tree-model.js').BuiltTreeModel} model
 */
function renderBuildPanel(model) {
  const fbsItems = Array.isArray(model.fbsItems) ? model.fbsItems : [];
  if (fbsItems.length === 0 && !model.bs) {
    return renderEmptyState({
      title: 'No build specifications on disk',
      hint: 'Add rcf/fbs/<file>.json entries and the viewer picks them up on the next walk.',
    });
  }
  const queue = computeQueue({ fbsItems });
  const buildableIds = new Set(
    queue.items.filter((i) => i.state === 'actionable').map((i) => i.fbsId),
  );
  const stats = {
    items: queue.totals.items,
    verified: queue.totals.verified,
    complete: queue.totals.complete,
    inProgress: queue.totals.inProgress,
    notStarted: queue.totals.notStarted,
    buildableNow: queue.totals.actionable,
  };
  const buildStats = renderBuildStats(stats);
  const pageHead = renderBuildPageHead(model.bs);

  const subTabs = renderSubTabStrip({
    hashKey: 'build',
    items: [
      { key: 'specs', label: 'Specs', controls: 'build-sub-specs' },
      { key: 'dag', label: 'DAG', controls: 'build-sub-dag' },
    ],
  });

  const specsPanel = renderBuildSpecsPanel(model, fbsItems, buildableIds);
  const dagLayout = buildDagLayout(fbsItems, buildableIds);
  const dagPanel = renderBuildDag({ layout: dagLayout, inspectorPayload: buildDagInspectorPayload(dagLayout) });
  // Hidden anchor so #BS-001 / #entity=BS-001 still resolve to this tab.
  const bsAnchor = model.bs
    ? `<span class="rcf-build-anchor" data-doc-id="${escapeHtml(model.bs.bsId)}" aria-hidden="true"></span>`
    : '';

  return `${bsAnchor}
${pageHead}
${buildStats}
${subTabs}
<section id="build-sub-specs" class="rcf-build-subpanel" data-rcf-subpanel="specs">
${specsPanel}
</section>
<section id="build-sub-dag" class="rcf-build-subpanel" data-rcf-subpanel="dag" hidden>
${dagPanel}
</section>`;
}

function renderBuildSpecsPanel(model, fbsItems, buildableIds) {
  const sorted = [...fbsItems].sort((a, b) => (a.buildOrder ?? 0) - (b.buildOrder ?? 0));
  const statusCounts = countBy(sorted, (f) => normaliseFacet(f.executionStatus));
  const areaCounts = countBy(sorted, (f) => normaliseFacet(f.domain));
  const sizeCounts = countBy(sorted, (f) => normaliseFacet(f.estimatedSize));

  const filterBar = renderFilterBar({
    hashKey: 'build-specs',
    placeholder: 'Filter specs by id or title',
    selects: [
      {
        key: 'status',
        label: 'Status',
        options: [{ value: '', label: 'Any status' }, ...facetOptions(statusCounts)],
      },
      {
        key: 'domain',
        label: 'Area',
        options: [{ value: '', label: 'All areas' }, ...facetOptions(areaCounts)],
      },
      {
        key: 'size',
        label: 'Size',
        options: [{ value: '', label: 'Any size' }, ...facetOptions(sizeCounts)],
      },
    ],
    toggles: [
      { key: 'buildable', label: `Buildable now (${buildableIds.size})` },
    ],
    count: { visible: sorted.length, total: sorted.length },
    showExpandAll: true,
  });

  const rows = sorted.map((f) => renderSpecRow(f, model, buildableIds)).join('\n');
  return `${filterBar}
<div class="rcf-build-specs-list" data-rcf-list="build-specs">
${rows}
</div>`;
}

function renderSpecRow(fbs, model, buildableIds) {
  const id = fbs.fbsId ?? 'FBS';
  const title = fbs.title ?? '';
  const order = typeof fbs.buildOrder === 'number' ? fbs.buildOrder : '';
  const acCount = Array.isArray(fbs.acIds) ? fbs.acIds.length : 0;
  const depCount = Array.isArray(fbs.dependsOnFbsIds) ? fbs.dependsOnFbsIds.length : 0;
  const depTitle = Array.isArray(fbs.dependsOnFbsIds) ? fbs.dependsOnFbsIds.join(', ') : '';
  const area = normaliseFacet(fbs.domain);
  const size = normaliseFacet(fbs.estimatedSize);
  const status = normaliseFacet(fbs.executionStatus);
  const buildable = buildableIds.has(id);

  const metaParts = [];
  if (area) metaParts.push(renderBadge({ value: area, variant: 'facet', title: 'Area' }));
  metaParts.push(renderBadge({ value: acCount, label: 'AC', variant: 'count', title: 'Acceptance criteria' }));
  if (depCount > 0) {
    metaParts.push(renderBadge({ value: depCount, label: 'deps', variant: 'count', title: depTitle || 'Dependency count' }));
  }
  if (size) metaParts.push(renderBadge({ value: size, variant: 'facet', title: 'Estimated size' }));
  if (buildable) metaParts.push(pill({ value: 'buildable', variant: 'build-queue', title: 'No unmet dependencies' }));
  if (status) metaParts.push(pill({ value: status, variant: 'doc-status' }));
  const meta = metaParts.join(' ');

  const idPrefix = order !== '' ? `<span class="rcf-spec-order mono muted small" title="Build order">${escapeHtml(String(order))}</span>` : '';
  const displayIdHtml = `${idPrefix}<span class="rcf-spec-id mono">${escapeHtml(id)}</span>`;

  const body = renderSpecBody(fbs, model, model.rawById?.get(id));
  // DocRow HTML-escapes the id arg; a sentinel string lets us swap in
  // live markup (order chip beside the mono id) after the row renders.
  const sentinel = '__RCF_SPEC_ID__';
  const row = renderDocRow({
    id: sentinel,
    title,
    body,
    meta,
    className: 'doc-fbs-wrap rcf-build-row',
    dataDocId: id,
  });
  const dataAttrs = ` data-status="${escapeHtml(status)}" data-domain="${escapeHtml(area)}" data-size="${escapeHtml(size)}" data-buildable="${buildable ? '1' : '0'}" data-text="${escapeHtml(buildSpecFilterText(fbs))}" title="${escapeHtml(id)}"`;
  return row
    .replace(/^<details /, `<details${dataAttrs} `)
    .replace(sentinel, displayIdHtml);
}

function buildSpecFilterText(fbs) {
  const parts = [fbs.fbsId, fbs.title, fbs.summary, fbs.approach, fbs.domain, fbs.estimatedSize, fbs.executionStatus];
  if (Array.isArray(fbs.deliverables)) parts.push(fbs.deliverables.join(' '));
  if (Array.isArray(fbs.acIds)) parts.push(fbs.acIds.join(' '));
  if (Array.isArray(fbs.dependsOnFbsIds)) parts.push(fbs.dependsOnFbsIds.join(' '));
  return parts.filter((v) => typeof v === 'string' && v.length > 0).join(' ').toLowerCase();
}

/**
 * Viewer UI refresh PR 2 (shell polish, Baz 2026-10-02; decision 17):
 * the one-bar header carries the project name only. The project name
 * is sourced from `manifest.projectName`, then `prd.productName`,
 * then `prd.productTitle` (the PRD title the brief names). Decision 17
 * is explicit: project name prominent after the icon mark, tool name
 * out of the bar, no technology chip. When the tree exposes no
 * project name, the whole product block collapses and the brand icon
 * stands on its own (silent empty state; CSS `.product:empty { display:none; }`).
 *
 * @param {import('./tree-model.js').BuiltTreeModel} model
 * @returns {{ projectName: string | null }}
 */
export function resolveProductHeader(model) {
  const projectName = model.manifest?.projectName
    ?? model.prd?.productName
    ?? model.prd?.productTitle
    ?? null;
  return { projectName };
}

function renderProductBlock(header) {
  if (!header.projectName) {
    // No project name: collapse. The empty .product block is hidden
    // by CSS so the brand icon stands on its own and PR 2's silent
    // empty state (brief) survives screen-reader output too.
    return '<div class="product"></div>';
  }
  return `<div class="product"><span class="name">${escapeHtml(header.projectName)}</span>
        <span class="sub">review surface</span></div>`;
}

function renderErrorBanner(errors) {
  if (!errors || errors.length === 0) return '';
  const count = errors.length;
  const noun = count === 1 ? 'error' : 'errors';
  const items = errors.slice(0, 20).map((e) => {
    const label = e.documentId ? `${e.documentId}` : e.filePath ?? '';
    return `<li><strong>${escapeHtml(e.kind)}</strong> ${escapeHtml(label)} - ${escapeHtml(e.message)}</li>`;
  }).join('');
  const more = count > 20 ? `<p><em>... and ${count - 20} more</em></p>` : '';
  return `<aside class="tree-errors" role="alert">
  <h2>Tree has ${count} ${noun}</h2>
  <ul>${items}</ul>
  ${more}
</aside>`;
}
