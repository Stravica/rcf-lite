// Assembles index.html from doc-renderer output and the per-REQ Mermaid
// subdiagrams. Phase 3.2 introduced the four-tab layout (Overview,
// Requirements, Architecture, Build sequence) plus nested `<details>`
// drill-down under Requirements. Phase 3.6 dropped the top-of-overview
// diagram - it was redundant with the PRD body's requirementIds list
// and unwieldy past ~15 REQs. Overview tab now renders the PRD body
// only. Client-side tabs + hash routing are wired by an inline script
// at the end of `<body>`; if JS is unavailable, every tabpanel is
// visible in DOM order (D12).
//
// Phase 3.8 wraps the swappable tree content in a stable
// `<div id="rcf-live-content">` (D13a) and always injects the live
// client script `<script src="/live-client.js" defer>` before `</body>`.
// The tab init routine is exposed as `window.rcfPage.init()` so the
// live client can re-invoke it after every SSE innerHTML swap.

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
  const projectName = model.manifest?.projectName ?? model.prd?.productName ?? 'RCF project';
  const contentHtml = renderContent(model);
  const script = inlineScript();

  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(projectName)} - RCF review surface</title>
  <link rel="icon" type="image/svg+xml" href="${FAVICON_HREF}">
  <link rel="stylesheet" href="style.css">
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
  <header>
    <h1>${escapeHtml(projectName)}</h1>
    <p class="subtitle">RCF review surface</p>
    <nav class="tabs" role="tablist" aria-label="Document sections">
      <button type="button" role="tab" data-tab="overview" aria-selected="true" aria-controls="tab-overview">Overview</button>
      <button type="button" role="tab" data-tab="product-map" aria-selected="false" aria-controls="tab-product-map">Product Map</button>
      <button type="button" role="tab" data-tab="requirements" aria-selected="false" aria-controls="tab-requirements">Requirements</button>
      <button type="button" role="tab" data-tab="architecture" aria-selected="false" aria-controls="tab-architecture">Architecture</button>
      <button type="button" role="tab" data-tab="build" aria-selected="false" aria-controls="tab-build">Build sequence</button>
    </nav>
  </header>
  <main>
    ${LIVE_WRAPPER_OPEN}
    ${contentHtml}
    ${LIVE_WRAPPER_CLOSE}
  </main>
  <footer>
    <p>Generated from the on-disk RCF tree at <code>rcf/</code>. Read-only; changes on disk stream to this tab automatically.</p>
    <p>Learn more about the Requirements Confidence Framework at <a href="https://stravica.ai/rcf-methodology" target="_blank" rel="noopener">stravica.ai/rcf-methodology</a>.</p>
  </footer>
  <script src="mermaid.min.js"></script>
  <script>${script}</script>
  <script src="/live-client.js" defer></script>
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

  const errorBanner = renderErrorBanner(model.errors ?? []);

  return `${errorBanner}
    <section id="tab-overview" role="tabpanel" aria-labelledby="tab-overview-button">
      <h2 class="tab-heading">Overview</h2>
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

// Inline client-side script: initialises Mermaid, wires tab switching,
// resolves hash routes to a tab + opens any ancestor `<details>` on the
// target. Vanilla; no dependencies beyond the vendored Mermaid loaded above.
// Phase 3.8 note: this script is byte-identical to the Phase 3.6 shape
// (the layout-regression test guards it). Live-swap recovery lives
// entirely in `src/view/live-client.js`, which reads state from the DOM
// after each SSE innerHTML swap - it does not call into this IIFE.
function inlineScript() {
  return `
(function () {
  var TABS = ['overview', 'requirements', 'architecture', 'build', 'product-map'];
  var PM_GROUPS = ['shape', 'component', 'trace', 'capability', 'blueprint'];
  var PM_STATUSES = ['all', 'draft', 'review', 'needsRevision', 'approved', 'superseded'];
  // Partial-render cache: grouping -> HTML string. First fetch fills it,
  // subsequent switches use the cache.
  var pmPartialCache = {};
  // Track whether an SSE swap has invalidated the cache since the last
  // successful hydration - the live-client sets window.__rcfPmDirty
  // after each swap, and we clear the cache on the next activation.
  function pmCacheKey(group) { return group; }

  function initMermaid() {
    if (typeof window.mermaid !== 'undefined') {
      window.mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });
    }
  }

  function runMermaidIn(container) {
    if (!container || typeof window.mermaid === 'undefined') return;
    var pending = container.querySelectorAll('.mermaid:not([data-processed="true"])');
    if (pending.length === 0) return;
    try {
      window.mermaid.run({ nodes: Array.prototype.slice.call(pending) });
    } catch (e) { /* swallow */ }
  }

  function tabButtons() {
    return Array.prototype.slice.call(document.querySelectorAll('nav.tabs [role="tab"]'));
  }

  function panelFor(name) {
    return document.getElementById('tab-' + name);
  }

  function activateTab(name) {
    if (TABS.indexOf(name) === -1) return false;
    tabButtons().forEach(function (btn) {
      var isTarget = btn.getAttribute('data-tab') === name;
      btn.setAttribute('aria-selected', isTarget ? 'true' : 'false');
    });
    TABS.forEach(function (t) {
      var p = panelFor(t);
      if (!p) return;
      if (t === name) {
        p.removeAttribute('hidden');
        runMermaidIn(p);
      } else {
        p.setAttribute('hidden', '');
      }
    });
    return true;
  }

  function tabForNode(node) {
    var cur = node;
    while (cur && cur !== document.body) {
      if (cur.getAttribute && cur.getAttribute('role') === 'tabpanel') {
        var id = cur.id || '';
        if (id.indexOf('tab-') === 0) return id.slice(4);
      }
      cur = cur.parentNode;
    }
    return null;
  }

  function openAncestorDetails(node) {
    var cur = node.parentNode;
    while (cur && cur !== document.body) {
      if (cur.tagName && cur.tagName.toLowerCase() === 'details') {
        cur.open = true;
      }
      cur = cur.parentNode;
    }
  }

  function findByDocId(id) {
    if (!id) return null;
    var byId = document.getElementById(id);
    if (byId) return byId;
    return document.querySelector('[data-doc-id="' + id.replace(/"/g, '\\\\"') + '"]');
  }

  function parseHashParams(raw) {
    var out = {};
    if (!raw) return out;
    var parts = raw.split('&');
    for (var i = 0; i < parts.length; i += 1) {
      var eq = parts[i].indexOf('=');
      if (eq === -1) continue;
      var k = parts[i].slice(0, eq);
      var v = parts[i].slice(eq + 1);
      if (k) out[k] = v;
    }
    return out;
  }

  function pmGroupPanel(name) {
    return document.getElementById('pm-group-' + name);
  }

  function hydrateLazyGroup(name, cb) {
    var panel = pmGroupPanel(name);
    if (!panel) { if (cb) cb(false); return; }
    if (panel.getAttribute('data-pm-lazy') !== 'true' && !pmPartialCache[pmCacheKey(name)]) {
      if (cb) cb(true);
      return;
    }
    if (window.__rcfPmDirty) {
      pmPartialCache = {};
      window.__rcfPmDirty = false;
    }
    var cached = pmPartialCache[pmCacheKey(name)];
    var heading = panel.querySelector('.pm-group-heading');
    var headingHtml = heading ? heading.outerHTML : '';
    if (cached) {
      panel.innerHTML = headingHtml + cached;
      panel.removeAttribute('data-pm-lazy');
      wireProductMapWithin(panel);
      if (cb) cb(true);
      return;
    }
    // Show a lightweight loading state.
    panel.setAttribute('data-pm-loading', 'true');
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/product-map/' + name, true);
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      panel.removeAttribute('data-pm-loading');
      if (xhr.status >= 200 && xhr.status < 300) {
        pmPartialCache[pmCacheKey(name)] = xhr.responseText;
        panel.innerHTML = headingHtml + xhr.responseText;
        panel.removeAttribute('data-pm-lazy');
        wireProductMapWithin(panel);
        if (cb) cb(true);
      } else {
        panel.setAttribute('data-pm-lazy', 'true');
        if (cb) cb(false);
      }
    };
    xhr.send();
  }

  function activatePmGroup(name, opts) {
    if (PM_GROUPS.indexOf(name) === -1) return false;
    var buttons = document.querySelectorAll('.pm-group-btn');
    for (var i = 0; i < buttons.length; i += 1) {
      var btn = buttons[i];
      var isTarget = btn.getAttribute('data-pm-group') === name;
      btn.setAttribute('aria-selected', isTarget ? 'true' : 'false');
    }
    var panels = document.querySelectorAll('.pm-group');
    for (var j = 0; j < panels.length; j += 1) {
      var p = panels[j];
      if (p.getAttribute('data-pm-group') === name) {
        p.removeAttribute('hidden');
      } else {
        p.setAttribute('hidden', '');
      }
    }
    var target = pmGroupPanel(name);
    if (target && target.getAttribute('data-pm-lazy') === 'true') {
      hydrateLazyGroup(name, function () {
        if (opts && opts.after) opts.after();
        applyPmStatusFilter(currentStatus());
      });
    } else {
      if (opts && opts.after) opts.after();
      applyPmStatusFilter(currentStatus());
    }
    return true;
  }

  function currentGroup() {
    var sel = document.querySelector('.pm-group-btn[aria-selected="true"]');
    return sel ? sel.getAttribute('data-pm-group') : 'shape';
  }

  function currentStatus() {
    var s = document.querySelector('.pm-status-select');
    return s ? s.value : 'all';
  }

  function currentOpenBuckets() {
    var group = currentGroup();
    var panel = pmGroupPanel(group);
    if (!panel) return [];
    var nodes = panel.querySelectorAll('details.pm-bucket[open]');
    var out = [];
    for (var i = 0; i < nodes.length; i += 1) {
      var id = nodes[i].getAttribute('data-pm-bucket-id');
      if (id) out.push(id);
    }
    return out;
  }

  function applyPmStatusFilter(status) {
    if (PM_STATUSES.indexOf(status) === -1) return false;
    var select = document.querySelector('.pm-status-select');
    if (select) select.value = status;
    var reqCards = document.querySelectorAll('#tab-product-map [data-req-status]');
    for (var i = 0; i < reqCards.length; i += 1) {
      var card = reqCards[i];
      var s = card.getAttribute('data-req-status') || '';
      if (status === 'all' || s === status) {
        card.removeAttribute('hidden');
      } else {
        card.setAttribute('hidden', '');
      }
    }
    // Per AC-17002-1: empty buckets under the filter are HIDDEN by
    // default with a "N empty" summary line to reveal them. Also keep
    // the legacy in-bucket note for tests / no-JS accessibility.
    var buckets = document.querySelectorAll('#tab-product-map .pm-group:not([hidden]) details.pm-bucket');
    var emptyCount = 0;
    for (var k = 0; k < buckets.length; k += 1) {
      var bk = buckets[k];
      var visible = bk.querySelectorAll('[data-req-status]:not([hidden])');
      var bodyEmpty = bk.querySelector('.pm-bucket-body') && bk.querySelector('.pm-bucket-body').children.length === 0;
      var isEmpty = visible.length === 0 && !bodyEmpty; // lazy-empty buckets don't count
      var body = bk.querySelector('.pm-bucket-body');
      var emptyNote = body ? body.querySelector('.pm-bucket-empty-filter') : null;
      if (isEmpty && status !== 'all') {
        if (body && !emptyNote) {
          emptyNote = document.createElement('p');
          emptyNote.className = 'pm-bucket-empty pm-bucket-empty-filter';
          emptyNote.innerHTML = '<em>0 requirements match this filter.</em>';
          body.appendChild(emptyNote);
        }
        bk.setAttribute('data-pm-empty-under-filter', 'true');
        emptyCount += 1;
      } else {
        if (emptyNote) emptyNote.parentNode.removeChild(emptyNote);
        bk.removeAttribute('data-pm-empty-under-filter');
      }
    }
    // Update the rollup summary.
    var activePanel = document.querySelector('#tab-product-map .pm-group:not([hidden])');
    if (activePanel) {
      var roll = activePanel.querySelector('.pm-empty-roll');
      if (roll) {
        var showBtn = roll.querySelector('.pm-empty-count');
        if (emptyCount > 0 && status !== 'all') {
          if (showBtn) showBtn.textContent = String(emptyCount);
          roll.removeAttribute('hidden');
          activePanel.classList.add('pm-hide-empty');
        } else {
          roll.setAttribute('hidden', '');
          activePanel.classList.remove('pm-hide-empty');
        }
      }
    }
    return true;
  }

  function updatePmHash() {
    if (!window.history || typeof window.history.pushState !== 'function') return;
    var group = currentGroup();
    var status = currentStatus();
    var open = currentOpenBuckets();
    var next = '#tab=product-map&group=' + group + '&status=' + status;
    if (open.length > 0) next += '&open=' + encodeURIComponent(open.join(','));
    if (window.location.hash === next) return;
    window.history.pushState(null, '', next);
  }

  function openPmBuckets(ids) {
    if (!ids || ids.length === 0) return;
    var group = currentGroup();
    var panel = pmGroupPanel(group);
    if (!panel) return;
    for (var i = 0; i < ids.length; i += 1) {
      var raw = ids[i];
      if (!raw) continue;
      var node = panel.querySelector('details.pm-bucket[data-pm-bucket-id="' + raw.replace(/"/g, '\\"') + '"]');
      if (node) node.open = true;
    }
  }

  function wireProductMapWithin(root) {
    root = root || document;
    // Bucket toggle -> push hash on user toggle. The 'toggle' event
    // fires for both open and close, from user action and from our own
    // scripting; guard against feedback via a dirty flag.
    var buckets = root.querySelectorAll('details.pm-bucket');
    for (var i = 0; i < buckets.length; i += 1) {
      var bk = buckets[i];
      if (bk.__rcfPmBucketWired) continue;
      bk.__rcfPmBucketWired = true;
      bk.addEventListener('toggle', function () {
        if (window.__rcfPmSuppress) return;
        updatePmHash();
      });
    }
    // Jump chip -> open bucket + scroll.
    var chips = root.querySelectorAll('.pm-jump-chip');
    for (var j = 0; j < chips.length; j += 1) {
      var chip = chips[j];
      if (chip.__rcfPmChipWired) continue;
      chip.__rcfPmChipWired = true;
      chip.addEventListener('click', function (ev) {
        var target = ev.currentTarget.getAttribute('data-pm-jump');
        var groupAttr = ev.currentTarget.closest('.pm-jump-nav').getAttribute('data-pm-jump-group');
        var panel = pmGroupPanel(groupAttr);
        if (!panel) return;
        var node = panel.querySelector('details.pm-bucket[data-pm-bucket-id="' + target.replace(/"/g, '\\"') + '"]');
        if (!node) return;
        node.open = true;
        try { node.scrollIntoView({ block: 'start' }); } catch (e) { node.scrollIntoView(); }
      });
    }
    // Bulk expand/collapse.
    var bulk = root.querySelectorAll('.pm-bulk-btn');
    for (var b = 0; b < bulk.length; b += 1) {
      var btn = bulk[b];
      if (btn.__rcfPmBulkWired) continue;
      btn.__rcfPmBulkWired = true;
      btn.addEventListener('click', function (ev) {
        var action = ev.currentTarget.getAttribute('data-pm-bulk');
        var panel = document.querySelector('#tab-product-map .pm-group:not([hidden])');
        if (!panel) return;
        var all = panel.querySelectorAll('details.pm-bucket');
        window.__rcfPmSuppress = true;
        for (var i = 0; i < all.length; i += 1) all[i].open = (action === 'expand');
        window.__rcfPmSuppress = false;
        updatePmHash();
      });
    }
    // Empty-roll toggle: reveals hidden empty buckets under the filter.
    var rolls = root.querySelectorAll('.pm-empty-toggle');
    for (var r = 0; r < rolls.length; r += 1) {
      var rt = rolls[r];
      if (rt.__rcfPmEmptyWired) continue;
      rt.__rcfPmEmptyWired = true;
      rt.addEventListener('click', function (ev) {
        var panel = ev.currentTarget.closest('.pm-group');
        if (!panel) return;
        if (panel.classList.contains('pm-hide-empty')) {
          panel.classList.remove('pm-hide-empty');
          ev.currentTarget.textContent = 'Hide empty buckets';
        } else {
          panel.classList.add('pm-hide-empty');
          var span = document.createElement('span');
          span.className = 'pm-empty-count';
          span.textContent = String(panel.querySelectorAll('details.pm-bucket[data-pm-empty-under-filter="true"]').length);
          ev.currentTarget.textContent = '';
          ev.currentTarget.appendChild(document.createTextNode('Show '));
          ev.currentTarget.appendChild(span);
          ev.currentTarget.appendChild(document.createTextNode(' empty buckets'));
        }
      });
    }
  }

  function wireProductMap() {
    var buttons = document.querySelectorAll('.pm-group-btn');
    for (var i = 0; i < buttons.length; i += 1) {
      if (buttons[i].__rcfPmWired) continue;
      buttons[i].__rcfPmWired = true;
      buttons[i].addEventListener('click', function (ev) {
        var name = ev.currentTarget.getAttribute('data-pm-group');
        if (activatePmGroup(name)) updatePmHash();
      });
    }
    var select = document.querySelector('.pm-status-select');
    if (select && !select.__rcfPmWired) {
      select.__rcfPmWired = true;
      select.addEventListener('change', function () {
        applyPmStatusFilter(select.value);
        updatePmHash();
      });
    }
    wireProductMapWithin(document);
  }

  function resolveHash(hash) {
    if (!hash) { activateTab('overview'); return; }
    var raw = hash.charAt(0) === '#' ? hash.slice(1) : hash;
    if (raw.indexOf('tab=') === 0) {
      var afterTab = raw.slice(4);
      var amp = afterTab.indexOf('&');
      var tab = amp === -1 ? afterTab : afterTab.slice(0, amp);
      var rest = amp === -1 ? '' : afterTab.slice(amp + 1);
      activateTab(tab);
      if (tab === 'product-map') {
        var params = parseHashParams(rest);
        var openIds = params.open ? decodeURIComponent(params.open).split(',').filter(Boolean) : [];
        activatePmGroup(params.group || 'shape', {
          after: function () {
            if (params.status) applyPmStatusFilter(params.status);
            openPmBuckets(openIds);
          },
        });
      }
      return;
    }
    var target = findByDocId(raw);
    if (!target) { activateTab('overview'); return; }
    var tab = tabForNode(target);
    if (tab) activateTab(tab);
    openAncestorDetails(target);
    if (target.tagName && target.tagName.toLowerCase() === 'details') target.open = true;
    try { target.scrollIntoView({ block: 'start' }); } catch (e) { target.scrollIntoView(); }
  }

  function onTabClick(ev) {
    var btn = ev.currentTarget;
    var name = btn.getAttribute('data-tab');
    if (!name) return;
    activateTab(name);
    if (name === 'product-map') {
      // Hydrate whichever grouping was selected last (default: shape).
      // No-op when the grouping is already inline.
      activatePmGroup(currentGroup());
    }
    if (window.history && typeof window.history.replaceState === 'function') {
      window.history.replaceState(null, '', '#tab=' + name);
    }
  }

  function wireTabs() {
    tabButtons().forEach(function (btn) {
      if (btn.__rcfTabWired) return;
      btn.__rcfTabWired = true;
      btn.addEventListener('click', onTabClick);
    });
  }

  var hashchangeWired = false;
  function onReady() {
    initMermaid();
    wireTabs();
    wireProductMap();
    resolveHash(window.location.hash);
    if (!hashchangeWired) {
      hashchangeWired = true;
      window.addEventListener('hashchange', function () {
        resolveHash(window.location.hash);
      });
    }
  }

  window.rcfPage = window.rcfPage || {};
  window.rcfPage.init = onReady;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }
})();
`.trim();
}
