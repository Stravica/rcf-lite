// Assembles index.html from doc-renderer output, the overview Mermaid block
// and the per-REQ subdiagrams. Phase 3.2 emits a four-tab layout
// (Overview, Requirements, Architecture, Build sequence) plus nested
// `<details>` drill-down under Requirements. Client-side tabs and hash
// routing are wired by an inline script at the end of `<body>`; if JS is
// unavailable, every tabpanel is visible in DOM order (D12).

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
import { allRequirementSubdiagrams, overviewDiagram } from './mermaid-diagram.js';

// Inline SVG favicon. Kept under 500 bytes (~330 chars) - simple monogram in
// the RCF palette. Delivered as a data URL so no separate file has to ship.
const FAVICON_HREF =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%231d4ed8'/%3E%3Ctext x='16' y='22' font-family='Arial' font-size='16' font-weight='700' fill='%23ffffff' text-anchor='middle'%3ER%3C/text%3E%3C/svg%3E";

/**
 * Render the complete index.html string.
 *
 * @param {import('./tree-model.js').BuiltTreeModel} model
 * @returns {string}
 */
export function renderPage(model) {
  const projectName = model.manifest?.projectName ?? model.prd?.productName ?? 'RCF project';
  const overview = overviewDiagram(model);
  const subdiagrams = allRequirementSubdiagrams(model);

  const prdSection = model.prd
    ? renderPrd(model.prd, {
      raw: model.rawById.get(model.prd.prdId),
      errors: model.errorsById.get(model.prd.prdId),
    })
    : '<p><em>No PRD on disk.</em></p>';

  const requirementsPanel = renderRequirementsPanel(model, subdiagrams);
  const architecturePanel = renderArchitecturePanel(model);
  const buildPanel = renderBuildPanel(model);

  const errorBanner = renderErrorBanner(model.errors ?? []);
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
      <button type="button" role="tab" data-tab="requirements" aria-selected="false" aria-controls="tab-requirements">Requirements</button>
      <button type="button" role="tab" data-tab="architecture" aria-selected="false" aria-controls="tab-architecture">Architecture</button>
      <button type="button" role="tab" data-tab="build" aria-selected="false" aria-controls="tab-build">Build sequence</button>
    </nav>
  </header>
  <main>
    ${errorBanner}
    <section id="tab-overview" role="tabpanel" aria-labelledby="tab-overview-button">
      <h2 class="tab-heading">Overview</h2>
      <div class="overview-diagram-wrap">
        <pre class="mermaid overview-diagram">${escapeHtml(overview)}</pre>
        <noscript><p><em>Overview diagram requires JavaScript to render. The document sections below are still usable.</em></p></noscript>
      </div>
      <div class="prd-body">
        ${prdSection}
      </div>
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
    </section>
  </main>
  <footer>
    <p>Generated from the on-disk RCF tree at <code>rcf/</code>. Read-only; regenerate with <code>rcf-view</code> to see fresh state.</p>
  </footer>
  <script src="mermaid.min.js"></script>
  <script>${script}</script>
</body>
</html>
`;
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
  const tadSection = model.tad
    ? renderTad(model.tad, {
      raw: model.rawById.get(model.tad.tadId),
      errors: model.errorsById.get(model.tad.tadId),
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
  const bsSection = model.bs
    ? renderBuildSequence(model.bs, {
      raw: model.rawById.get(model.bs.bsId),
      errors: model.errorsById.get(model.bs.bsId),
    })
    : '<p><em>No build sequence on disk.</em></p>';

  const fbsBlocks = model.fbsItems.map((f) => detailsWrap({
    id: f.fbsId,
    summary: `${f.fbsId} - ${f.title ?? ''}`,
    className: 'doc-fbs-wrap',
    status: f.status,
    body: renderFbs(f, {
      raw: model.rawById.get(f.fbsId),
      errors: model.errorsById.get(f.fbsId),
      usByAcId: model.usByAcId,
    }),
  })).join('\n');

  const tsBlocks = model.testSuites.map((ts) => detailsWrap({
    id: ts.tsId,
    summary: `${ts.tsId} - test suite`,
    className: 'doc-ts-wrap',
    body: renderTestSuite(ts, {
      raw: model.rawById.get(ts.tsId),
      errors: model.errorsById.get(ts.tsId),
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
function inlineScript() {
  return `
(function () {
  var TABS = ['overview', 'requirements', 'architecture', 'build'];

  function initMermaid() {
    if (typeof window.mermaid !== 'undefined') {
      // startOnLoad: false. Mermaid can't lay out diagrams inside a
      // display:none tabpanel (getBoundingClientRect is 0x0 -> NaN
      // transforms). We run each tab's diagrams on activation instead;
      // runMermaidIn is idempotent via the data-processed attribute.
      window.mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });
    }
  }

  function runMermaidIn(container) {
    if (!container || typeof window.mermaid === 'undefined') return;
    var pending = container.querySelectorAll('.mermaid:not([data-processed="true"])');
    if (pending.length === 0) return;
    try {
      window.mermaid.run({ nodes: Array.prototype.slice.call(pending) });
    } catch (e) {
      // Mermaid.run may throw on init errors; do not block the UI.
    }
  }

  function tabButtons() {
    return Array.prototype.slice.call(document.querySelectorAll('[role="tab"]'));
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

  function resolveHash(hash) {
    if (!hash) {
      activateTab('overview');
      return;
    }
    var raw = hash.charAt(0) === '#' ? hash.slice(1) : hash;
    if (raw.indexOf('tab=') === 0) {
      activateTab(raw.slice(4));
      return;
    }
    var target = findByDocId(raw);
    if (!target) {
      activateTab('overview');
      return;
    }
    var tab = tabForNode(target);
    if (tab) activateTab(tab);
    openAncestorDetails(target);
    if (target.tagName && target.tagName.toLowerCase() === 'details') {
      target.open = true;
    }
    try {
      target.scrollIntoView({ block: 'start' });
    } catch (e) {
      target.scrollIntoView();
    }
  }

  function onTabClick(ev) {
    var btn = ev.currentTarget;
    var name = btn.getAttribute('data-tab');
    if (!name) return;
    activateTab(name);
    if (window.history && typeof window.history.replaceState === 'function') {
      window.history.replaceState(null, '', '#tab=' + name);
    }
  }

  function wireTabs() {
    tabButtons().forEach(function (btn) {
      btn.addEventListener('click', onTabClick);
    });
  }

  function onReady() {
    initMermaid();
    wireTabs();
    resolveHash(window.location.hash);
    window.addEventListener('hashchange', function () {
      resolveHash(window.location.hash);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }
})();
`.trim();
}
