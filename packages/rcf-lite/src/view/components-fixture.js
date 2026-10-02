// Component fixture page for the viewer UI refresh (PR 2). Each shared
// component is rendered once in isolation with representative sample
// data, so a human reviewer can eyeball it and the test suite can
// assert both the standalone-render shape and the fixture-page
// composition (test/view/components-fixture.test.js).
//
// The fixture page is served at `/_fixtures/components` on the live
// viewer. It is a self-contained HTML document that reuses the
// production ./style.css + ./page-init.js so theme toggling, Toast
// wiring and sticky layout all behave the same as inside a real tab.

import { escapeHtml } from './doc-renderers/helpers.js';
import {
  pill,
  renderDocRow,
  renderBadge,
  renderFilterBar,
  renderEmptyState,
  renderToastContainer,
  renderSubTabStrip,
  renderEntitySelector,
} from './components/index.js';

/**
 * @typedef {object} ComponentSection
 * @property {string} id         slug used as the anchor and in testing
 * @property {string} title      visible heading
 * @property {string} intent     short caption shown under the heading
 * @property {string} html       the rendered component HTML
 */

/**
 * Produce the sample DocRow set used in both the closed and open demo
 * blocks. Deterministic so the test suite can assert the output byte for
 * byte if it wants to.
 *
 * @returns {ComponentSection[]}
 */
export function componentSections() {
  const docRowMeta = [
    renderBadge({ value: 3, label: 'US', title: '3 user stories' }),
    renderBadge({ value: 7, label: 'AC', title: '7 acceptance criteria' }),
    pill({ value: 'inProgress', variant: 'status', title: 'Status' }),
  ].join(' ');

  const docRowClosed = renderDocRow({
    id: 'REQ-002',
    title: 'Tree walker loads every document in one pass',
    body: '<p>This body is only visible when the row is open. Try the open row below.</p>',
    className: 'doc-req-wrap',
    meta: docRowMeta,
  });

  const docRowOpen = renderDocRow({
    id: 'REQ-003',
    title: 'Live view server streams tree-update events',
    body: `
      <p><strong>Executive summary:</strong> The viewer owns an HTTP + SSE loop
      that walks the tree on any <code>rcf/</code> change and ships the new
      <code>#rcf-live-content</code> innerHTML to every connected tab.</p>
      <h4>Rationale</h4>
      <p>Keeps authored content in sync with the review surface without a
      reload; a product owner viewing the page sees their last save moments
      after Ctrl-S.</p>
    `,
    className: 'doc-req-wrap',
    meta: docRowMeta,
    open: true,
  });

  const filterBar = renderFilterBar({
    hashKey: 'requirements',
    placeholder: 'Search 24 requirements',
    text: '',
    selects: [
      {
        key: 'area',
        label: 'Area',
        value: '',
        options: [
          { value: '', label: 'All areas' },
          { value: 'tree', label: 'Tree walker' },
          { value: 'viewer', label: 'Viewer' },
          { value: 'readiness', label: 'Readiness' },
        ],
      },
      {
        key: 'status',
        label: 'Status',
        value: 'inProgress',
        options: [
          { value: '', label: 'Any' },
          { value: 'notStarted', label: 'Not started' },
          { value: 'inProgress', label: 'In progress' },
          { value: 'complete', label: 'Complete' },
        ],
      },
    ],
    toggles: [
      { key: 'needsWork', label: 'Needs work only', checked: false },
    ],
    count: { visible: 11, total: 24 },
    showExpandAll: true,
  });

  const badgeRow = [
    renderBadge({ value: 3, label: 'US' }),
    renderBadge({ value: 7, label: 'AC' }),
    renderBadge({ value: 'tree-walker', variant: 'facet', title: 'Area facet' }),
    renderBadge({ value: 'needs-work', variant: 'facet' }),
    renderBadge({ value: 12, label: 'open', variant: 'accent', title: 'Buildable now' }),
  ].join(' ');

  const emptyState = renderEmptyState({
    title: 'Nothing written yet',
    hint: 'The architecture section for data flow has no content on disk.',
    actionHtml: `Author it with <code>rcf define update TAD-001 --set dataArchitecture.flow</code>.`,
  });

  const toast = `${renderToastContainer()}
    <p class="rcf-fixture-note">The Toast container is empty on first paint. Press the demo button to flash
    a message through the shared <code>window.rcfView.showToast()</code> helper (wired by page-init.js).</p>
    <p><button type="button" class="rcf-fixture-toast-btn" data-rcf-fixture-toast>Show a toast</button></p>`;

  const subTabStrip = `${renderSubTabStrip({
    hashKey: 'build',
    items: [
      { key: 'specs', label: 'Specs' },
      { key: 'dag', label: 'DAG' },
    ],
    active: 'specs',
  })}
    <p class="rcf-fixture-note">Marks one item active via <code>aria-selected</code>; the shared
    page-init.js router will later own the hash write.</p>`;

  const entitySelector = renderEntitySelector({
    hashKey: 'requirements',
    targetTab: 'requirements',
    facetKey: 'domain',
    items: [
      { id: 'REQ-001', title: 'On-disk RCF project structure', facet: 'projectStructure' },
      { id: 'REQ-002', title: 'Visual review surface', facet: 'view' },
      { id: 'REQ-003', title: 'Deterministic CRUD over RCF documents', facet: 'crud' },
      { id: 'REQ-010', title: 'Blueprint library mechanism', facet: 'cli' },
      { id: 'REQ-011', title: 'E2E verification contract', facet: 'verify' },
      { id: 'REQ-012', title: 'Core shelf: probe-path binding', facet: 'blueprints' },
    ],
    totalLabel: '6 sample requirements in 6 areas (demo data)',
    placeholder: `Jump to a requirement by id or title (e.g. REQ-010 or 'review')`,
  });

  return [
    {
      id: 'doc-row',
      title: 'DocRow',
      intent: 'The one collapsible for every per-document row. Closed by default; the body renders only when open.',
      html: `${docRowClosed}\n${docRowOpen}`,
    },
    {
      id: 'filter-bar',
      title: 'FilterBar',
      intent: 'Shared facet strip above a list. Text, selects, toggles, live count, Expand all.',
      html: filterBar,
    },
    {
      id: 'badge',
      title: 'Badge',
      intent: 'A compact numeric count or facet marker. Variants: count (default), facet, accent.',
      html: `<div class="rcf-fixture-badge-row">${badgeRow}</div>`,
    },
    {
      id: 'empty-state',
      title: 'EmptyState',
      intent: 'The dashed "nothing here yet" block for empty lists or missing sections.',
      html: emptyState,
    },
    {
      id: 'toast',
      title: 'Toast',
      intent: 'A single transient status message, bottom-centre, lives in the AppShell so it survives SSE swaps.',
      html: toast,
    },
    {
      id: 'sub-tab-strip',
      title: 'SubTabStrip',
      intent: 'The chip strip inside a tab panel (Build Specs | DAG in PRs 5-6).',
      html: subTabStrip,
    },
    {
      id: 'entity-selector',
      title: 'EntitySelector',
      intent: 'Total line + type-ahead jump + area chips with counts. The PRD tab mounts one of these to replace the 109 inline requirement links (PR 3, decision 4).',
      html: entitySelector,
    },
  ];
}

/**
 * Render the complete fixture page HTML. Self-contained; references
 * only `./style.css` and `./page-init.js` so the page works under the
 * same reverse-proxy mount the real viewer uses.
 *
 * @returns {string}
 */
export function renderComponentsFixturePage() {
  const sections = componentSections();
  const nav = sections.map((s) => `<a href="#${escapeHtml(s.id)}">${escapeHtml(s.title)}</a>`).join(' ');
  const blocks = sections.map((s) => `
    <section id="${escapeHtml(s.id)}" class="rcf-fixture-section">
      <h2>${escapeHtml(s.title)}</h2>
      <p class="rcf-fixture-intent">${escapeHtml(s.intent)}</p>
      <div class="rcf-fixture-stage">
        ${s.html}
      </div>
    </section>`).join('\n');

  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Viewer UI refresh - component fixtures</title>
  <link rel="stylesheet" href="./style.css">
  <style>
    body { padding: 0; }
    .rcf-fixture-header { max-width: 1024px; margin: 0 auto; padding: 1.25rem 1rem 0.5rem; }
    .rcf-fixture-header h1 { margin: 0 0 0.35rem; font-size: 1.4rem; letter-spacing: -0.01em; }
    .rcf-fixture-header p { margin: 0; color: var(--sv-muted); font-size: 0.9rem; }
    .rcf-fixture-themes { margin: 0.5rem 0 0; display: inline-flex; gap: 0.4rem; align-items: center; font-size: 0.85rem; color: var(--sv-muted); }
    .rcf-fixture-themes button { appearance: none; border: 1px solid var(--sv-control); background: var(--sv-surface); color: var(--sv-ink); padding: 0.25rem 0.6rem; border-radius: 6px; cursor: pointer; font-family: inherit; font-size: 0.85rem; }
    .rcf-fixture-themes button[aria-pressed="true"] { background: var(--sv-active); border-color: var(--sv-link); color: var(--sv-link); font-weight: 600; }
    .rcf-fixture-nav { max-width: 1024px; margin: 0 auto; padding: 0.5rem 1rem 1rem; border-bottom: 1px solid var(--sv-border); display: flex; flex-wrap: wrap; gap: 0.6rem; }
    .rcf-fixture-nav a { color: var(--sv-link); font-size: 0.85rem; text-decoration: none; padding: 0.15rem 0.5rem; border: 1px solid var(--sv-border); border-radius: 999px; background: var(--sv-surface); }
    .rcf-fixture-nav a:hover { background: var(--sv-active); border-color: var(--sv-link); }
    main.rcf-fixture-main { max-width: 1024px; margin: 0 auto; padding: 1rem 1rem 4rem; }
    .rcf-fixture-section { margin: 1.75rem 0 2.5rem; }
    .rcf-fixture-section h2 { margin: 0 0 0.25rem; font-size: 1.1rem; font-weight: 700; letter-spacing: -0.01em; }
    .rcf-fixture-intent { margin: 0 0 0.75rem; color: var(--sv-muted); font-size: 0.9rem; }
    .rcf-fixture-stage { padding: 1rem; border: 1px dashed var(--sv-border); border-radius: 10px; background: var(--sv-surface); }
    .rcf-fixture-badge-row { display: flex; flex-wrap: wrap; gap: 0.5rem; }
    .rcf-fixture-note { color: var(--sv-muted); font-size: 0.85rem; margin: 0.5rem 0 0; }
    .rcf-fixture-toast-btn { appearance: none; border: 1px solid var(--sv-link); background: var(--sv-button); color: var(--sv-onbutton); padding: 0.35rem 0.9rem; border-radius: 6px; cursor: pointer; font-family: inherit; font-weight: 600; }
    .rcf-fixture-toast-btn:hover { background: var(--sv-hover); }
  </style>
</head>
<body data-rcf-fixture="components">
  <header class="rcf-fixture-header">
    <h1>Viewer UI refresh &middot; shared component fixtures</h1>
    <p>PR 2 (w-2026-10-02-dave-010). Each block renders a single component with a representative payload. Toggle theme to check both colour sets.</p>
    <div class="rcf-fixture-themes" role="group" aria-label="Theme">
      <span>Theme</span>
      <button type="button" data-rcf-fixture-theme="light" aria-pressed="false">Light</button>
      <button type="button" data-rcf-fixture-theme="dark" aria-pressed="false">Dark</button>
      <button type="button" data-rcf-fixture-theme="auto" aria-pressed="true">Auto</button>
    </div>
  </header>
  <nav class="rcf-fixture-nav" aria-label="Fixture sections">${nav}</nav>
  <main class="rcf-fixture-main">
    ${blocks}
  </main>
  <script src="./page-init.js" defer></script>
</body>
</html>
`;
}
