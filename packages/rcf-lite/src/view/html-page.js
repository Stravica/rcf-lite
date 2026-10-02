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
  renderBuildSequence,
  renderFbs,
  renderPrd,
  renderReq,
  renderTac,
  renderTad,
  renderTestSuite,
  renderUserStory,
} from './doc-renderers/index.js';
import { detailsWrap, escapeHtml } from './doc-renderers/helpers.js';
import { allRequirementSubdiagrams } from './mermaid-diagram.js';
import { renderProductMapPanel } from './product-map.js';
import { renderReadinessPanel } from './readiness.js';
import { renderToastContainer } from './components/toast.js';

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
        <button type="button" role="tab" data-tab="build" aria-selected="false" aria-controls="tab-build">Build sequence</button>
      </nav>
      <div class="tools" aria-label="Viewer tools"></div>
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

  const prdSection = model.prd
    ? renderPrd(model.prd, {
      raw: model.rawById.get(model.prd.prdId),
      errors: model.errorsById.get(model.prd.prdId),
      requirementIds: model.childrenByParent.get(model.prd.prdId) ?? [],
    })
    : '<p><em>No PRD on disk.</em></p>';

  const requirementsPanel = renderRequirementsPanel(model, subdiagrams);
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
      <h2 class="tab-heading">Build sequence</h2>
      ${buildPanel}
    </section>`;
}

function renderRequirementsPanel(model, subdiagrams) {
  if (model.requirements.length === 0 && model.userStories.length === 0) {
    return '<p><em>No requirements on disk.</em></p>';
  }
  const reqBlocks = model.requirements.map((r) => {
    const reqBody = renderReq(r, {
      raw: model.rawById.get(r.reqId),
      errors: model.errorsById.get(r.reqId),
      subdiagram: subdiagrams.get(r.reqId),
    });
    const stories = model.storiesByReqId.get(r.reqId) ?? [];
    const usBlocks = stories.map((u) => detailsWrap({
      id: u.usId,
      summary: `${u.usId} - ${u.title ?? ''}`,
      className: 'doc-us-wrap',
      status: u.status,
      body: renderUserStory(u, {
        raw: model.rawById.get(u.usId),
        errors: model.errorsById.get(u.usId),
        fbsByAcId: model.fbsByAcId,
      }),
    })).join('\n');
    const storiesSection = usBlocks
      ? `<section class="nested-details"><h4>User stories</h4>${usBlocks}</section>`
      : '<p><em>No user stories under this requirement.</em></p>';
    return detailsWrap({
      id: r.reqId,
      summary: `${r.reqId} - ${r.title ?? ''}`,
      className: 'doc-req-wrap',
      status: r.status,
      body: `${reqBody}\n${storiesSection}`,
    });
  }).join('\n');

  const orphanUs = model.userStories.filter((u) => !u.reqId || !model.requirements.some((r) => r.reqId === u.reqId));
  const orphanBlock = orphanUs.length > 0
    ? `<section class="orphan-us"><h3>Orphan user stories</h3>${orphanUs.map((u) => detailsWrap({
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

  return `${reqBlocks}\n${orphanBlock}`;
}

function renderArchitecturePanel(model) {
  const tadChildren = model.tad ? (model.childrenByParent.get(model.tad.tadId) ?? []) : [];
  const componentIds = tadChildren.filter((id) => id.startsWith('TAC-'));
  const architecturalDecisionIds = tadChildren.filter((id) => id.startsWith('ADR-'));
  const tadSection = model.tad
    ? renderTad(model.tad, {
      raw: model.rawById.get(model.tad.tadId),
      errors: model.errorsById.get(model.tad.tadId),
      componentIds,
      architecturalDecisionIds,
    })
    : '<p><em>No TAD on disk.</em></p>';

  const tacBlocks = model.tacs.map((t) => detailsWrap({
    id: t.tacId,
    summary: `${t.tacId} - ${t.name ?? ''}`,
    className: 'doc-tac-wrap',
    status: t.status,
    body: renderTac(t, {
      raw: model.rawById.get(t.tacId),
      errors: model.errorsById.get(t.tacId),
    }),
  })).join('\n');

  const adrBlocks = model.adrs.map((a) => detailsWrap({
    id: a.adrId,
    summary: `${a.adrId} - ${a.title ?? ''}`,
    className: 'doc-adr-wrap',
    status: a.status,
    body: renderAdr(a, {
      raw: model.rawById.get(a.adrId),
      errors: model.errorsById.get(a.adrId),
    }),
  })).join('\n');

  return `
${tadSection}
<h3 class="group-heading">Components</h3>
${tacBlocks || '<p><em>No TAC components on disk.</em></p>'}
<h3 class="group-heading">Architectural decisions</h3>
${adrBlocks || '<p><em>No ADRs on disk.</em></p>'}
`;
}

function renderBuildPanel(model) {
  const bsSlots = model.bs
    ? [...model.fbsItems]
      .filter((f) => f.bsId === model.bs.bsId)
      .sort((a, b) => (a.buildOrder ?? 0) - (b.buildOrder ?? 0))
      .map((f) => ({
        fbsId: f.fbsId,
        buildOrder: f.buildOrder,
        executionStatus: f.executionStatus,
        title: f.title,
      }))
    : [];
  const bsSection = model.bs
    ? renderBuildSequence(model.bs, {
      raw: model.rawById.get(model.bs.bsId),
      errors: model.errorsById.get(model.bs.bsId),
      slots: bsSlots,
    })
    : '<p><em>No build sequence on disk.</em></p>';

  const fbsBlocks = model.fbsItems.map((f) => detailsWrap({
    id: f.fbsId,
    summary: `${f.fbsId} - ${f.title ?? ''}`,
    className: 'doc-fbs-wrap',
    status: f.executionStatus,
    body: renderFbs(f, {
      raw: model.rawById.get(f.fbsId),
      errors: model.errorsById.get(f.fbsId),
      usByAcId: model.usByAcId,
    }),
  })).join('\n');

  const tsBlocks = model.testSuites.map((ts) => detailsWrap({
    id: ts.id,
    summary: `${ts.id} - ${ts.title ?? 'test suite'}`,
    className: 'doc-ts-wrap',
    status: ts.status,
    body: renderTestSuite(ts, {
      raw: model.rawById.get(ts.id),
      errors: model.errorsById.get(ts.id),
    }),
  })).join('\n');

  const tsSection = tsBlocks
    ? `<h3 class="group-heading">Test suites</h3>${tsBlocks}`
    : '';

  return `
${bsSection}
<h3 class="group-heading">Functional Build Specifications</h3>
${fbsBlocks || '<p><em>No FBS items on disk.</em></p>'}
${tsSection}
`;
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
