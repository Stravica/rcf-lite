// Assembles index.html from doc-renderer output, the master Mermaid block
// and the per-REQ subdiagrams. Vanilla template strings; no engine.

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
import { escapeHtml } from './doc-renderers/helpers.js';
import { allRequirementSubdiagrams, masterDiagram } from './mermaid-diagram.js';

/**
 * Render the complete index.html string.
 *
 * @param {import('./tree-model.js').BuiltTreeModel} model
 * @returns {string}
 */
export function renderPage(model) {
  const projectName = model.manifest?.projectName ?? model.prd?.productName ?? 'RCF project';
  const master = masterDiagram(model);
  const subdiagrams = allRequirementSubdiagrams(model);

  const prdSection = model.prd
    ? renderPrd(model.prd, {
      raw: model.rawById.get(model.prd.prdId),
      errors: model.errorsById.get(model.prd.prdId),
    })
    : '<p><em>No PRD on disk.</em></p>';

  const reqSections = model.requirements.map((r) => renderReq(r, {
    raw: model.rawById.get(r.reqId),
    errors: model.errorsById.get(r.reqId),
    userStories: model.storiesByReqId.get(r.reqId) ?? [],
    subdiagram: subdiagrams.get(r.reqId),
  })).join('\n');

  const usSections = model.userStories.map((u) => renderUserStory(u, {
    raw: model.rawById.get(u.usId),
    errors: model.errorsById.get(u.usId),
    fbsByAcId: model.fbsByAcId,
  })).join('\n');

  const tadSection = model.tad
    ? renderTad(model.tad, {
      raw: model.rawById.get(model.tad.tadId),
      errors: model.errorsById.get(model.tad.tadId),
    })
    : '<p><em>No TAD on disk.</em></p>';

  const tacSections = model.tacs.map((t) => renderTac(t, {
    raw: model.rawById.get(t.tacId),
    errors: model.errorsById.get(t.tacId),
  })).join('\n');

  const adrSections = model.adrs.map((a) => renderAdr(a, {
    raw: model.rawById.get(a.adrId),
    errors: model.errorsById.get(a.adrId),
  })).join('\n');

  const bsSection = model.bs
    ? renderBuildSequence(model.bs, {
      raw: model.rawById.get(model.bs.bsId),
      errors: model.errorsById.get(model.bs.bsId),
    })
    : '<p><em>No build sequence on disk.</em></p>';

  const fbsSections = model.fbsItems.map((f) => renderFbs(f, {
    raw: model.rawById.get(f.fbsId),
    errors: model.errorsById.get(f.fbsId),
    usByAcId: model.usByAcId,
  })).join('\n');

  const tsSections = model.testSuites.map((ts) => renderTestSuite(ts, {
    raw: model.rawById.get(ts.tsId),
    errors: model.errorsById.get(ts.tsId),
  })).join('\n');

  const errorBanner = renderErrorBanner(model.errors ?? []);

  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(projectName)} - RCF review surface</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header>
    <h1>${escapeHtml(projectName)}</h1>
    <p class="subtitle">Visual review surface for the on-disk RCF tree</p>
    <nav class="toc">
      <a href="#diagram">Diagram</a>
      <a href="#prd">PRD</a>
      <a href="#requirements">Requirements</a>
      <a href="#user-stories">User stories</a>
      <a href="#architecture">Architecture</a>
      <a href="#build">Build sequence and FBS</a>
      ${model.testSuites.length > 0 ? '<a href="#test-suites">Test suites</a>' : ''}
    </nav>
  </header>
  <main>
    ${errorBanner}
    <section id="diagram">
      <h2>Tree diagram</h2>
      <pre class="mermaid">${escapeHtml(master)}</pre>
    </section>

    <section id="prd">
      <h2>Product Requirements</h2>
      ${prdSection}
    </section>

    <section id="requirements">
      <h2>Requirements</h2>
      ${reqSections || '<p><em>No requirements on disk.</em></p>'}
    </section>

    <section id="user-stories">
      <h2>User stories</h2>
      ${usSections || '<p><em>No user stories on disk.</em></p>'}
    </section>

    <section id="architecture">
      <h2>Architecture</h2>
      ${tadSection}
      <h3 class="group-heading">Components</h3>
      ${tacSections || '<p><em>No TAC components on disk.</em></p>'}
      <h3 class="group-heading">Architectural decisions</h3>
      ${adrSections || '<p><em>No ADRs on disk.</em></p>'}
    </section>

    <section id="build">
      <h2>Build sequence and FBS</h2>
      ${bsSection}
      <h3 class="group-heading">Functional Build Specifications</h3>
      ${fbsSections || '<p><em>No FBS items on disk.</em></p>'}
    </section>

    ${model.testSuites.length > 0 ? `<section id="test-suites">
      <h2>Test suites</h2>
      ${tsSections}
    </section>` : ''}
  </main>
  <footer>
    <p>Generated from the on-disk RCF tree at <code>rcf/</code>. Read-only; regenerate with <code>rcf-view</code> to see fresh state.</p>
  </footer>
  <script src="mermaid.min.js"></script>
  <script>
    document.addEventListener('DOMContentLoaded', function () {
      if (typeof mermaid !== 'undefined') {
        mermaid.initialize({ startOnLoad: true, securityLevel: 'loose' });
      }
    });
  </script>
</body>
</html>
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
