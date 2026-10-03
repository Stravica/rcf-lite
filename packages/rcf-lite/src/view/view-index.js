// Viewer UI refresh PR 7 (TAC-4132, ADR-4134): the ID lookup index
// built once per rewalk from BuiltTreeModel. One row per document id
// plus one row per AC under each US, with the minimum metadata the
// LookupModal needs to rank and route: `{ id, kind, title, snippet,
// parent, tab }`. The server serves this via `GET /index.json` so
// wespa's reverse proxy sees it as a new relative route under the
// mount point (release-noted; ADR-4134 names the alternatives rejected).
//
// Pure projection: reads nothing beyond the model and returns a plain
// JSON-safe object. The viewer client fetches it lazily on first open
// and refreshes it when the SSE tree-update broadcast lands.

const SNIPPET_LIMIT = 110;

const TAB_BY_KIND = {
  prd: 'overview',
  req: 'requirements',
  us: 'requirements',
  ac: 'requirements',
  tad: 'architecture',
  tac: 'architecture',
  adr: 'architecture',
  bs: 'build',
  fbs: 'build',
  ts: 'requirements',
};

/**
 * @typedef {object} IndexRow
 * @property {string} id        canonical document / AC id
 * @property {'prd'|'req'|'us'|'ac'|'tad'|'tac'|'adr'|'bs'|'fbs'|'ts'} kind
 * @property {string} title     display title (empty string on a doc with no title)
 * @property {string} snippet   first SNIPPET_LIMIT chars of the kind's prose field with whitespace collapsed
 * @property {string} parent    parent document id (empty string when none; e.g. the PRD has no parent)
 * @property {'overview'|'requirements'|'architecture'|'build'} tab
 */

/**
 * Collapse an arbitrary string to the first SNIPPET_LIMIT characters
 * with every whitespace run normalised to a single space, so the
 * modal rows render consistently and the JSON payload stays small.
 *
 * @param {unknown} raw
 * @returns {string}
 */
function snippetOf(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return '';
  const flat = raw.replace(/\s+/g, ' ').trim();
  if (flat.length <= SNIPPET_LIMIT) return flat;
  return flat.slice(0, SNIPPET_LIMIT);
}

/**
 * Build the ID lookup index from a BuiltTreeModel. One row per
 * document id (PRD, REQ, US, TAD, TAC, ADR, BS, FBS, TS) plus one row
 * per AC on each US. Rows carry `{ id, kind, title, snippet, parent,
 * tab }` and nothing else; the client renders every surface detail
 * (count badge, kind pill) from this core shape.
 *
 * @param {import('./tree-model.js').BuiltTreeModel} model
 * @returns {{ rows: IndexRow[] }}
 */
export function buildViewIndex(model) {
  const rows = [];

  const prd = model?.prd;
  if (prd?.prdId) {
    rows.push({
      id: prd.prdId,
      kind: 'prd',
      title: typeof prd.productName === 'string' ? prd.productName : '',
      snippet: snippetOf(prd.executiveSummary ?? prd.problemStatement ?? ''),
      parent: '',
      tab: TAB_BY_KIND.prd,
    });
  }

  for (const r of model?.requirements ?? []) {
    if (!r?.reqId) continue;
    rows.push({
      id: r.reqId,
      kind: 'req',
      title: typeof r.title === 'string' ? r.title : '',
      snippet: snippetOf(r.description ?? r.rationale ?? ''),
      parent: typeof r.prdId === 'string' ? r.prdId : '',
      tab: TAB_BY_KIND.req,
    });
  }

  for (const us of model?.userStories ?? []) {
    if (!us?.usId) continue;
    rows.push({
      id: us.usId,
      kind: 'us',
      title: typeof us.title === 'string' ? us.title : '',
      snippet: snippetOf(us.description ?? us.iWant ?? ''),
      parent: typeof us.reqId === 'string' ? us.reqId : '',
      tab: TAB_BY_KIND.us,
    });
    for (const ac of us.acceptanceCriteria ?? []) {
      if (!ac?.id) continue;
      rows.push({
        id: ac.id,
        kind: 'ac',
        title: '',
        snippet: snippetOf(ac.description ?? ''),
        parent: us.usId,
        tab: TAB_BY_KIND.ac,
      });
    }
  }

  const tad = model?.tad;
  if (tad?.tadId) {
    rows.push({
      id: tad.tadId,
      kind: 'tad',
      title: typeof tad.title === 'string' ? tad.title : '',
      snippet: snippetOf(tad.systemOverview ?? ''),
      parent: typeof tad.prdId === 'string' ? tad.prdId : '',
      tab: TAB_BY_KIND.tad,
    });
  }

  for (const t of model?.tacs ?? []) {
    if (!t?.tacId) continue;
    rows.push({
      id: t.tacId,
      kind: 'tac',
      title: typeof t.name === 'string' ? t.name : '',
      snippet: snippetOf(t.purpose ?? ''),
      parent: typeof t.tadId === 'string' ? t.tadId : '',
      tab: TAB_BY_KIND.tac,
    });
  }

  for (const a of model?.adrs ?? []) {
    if (!a?.adrId) continue;
    rows.push({
      id: a.adrId,
      kind: 'adr',
      title: typeof a.title === 'string' ? a.title : '',
      snippet: snippetOf(a.decision ?? a.context ?? ''),
      parent: typeof a.tadId === 'string' ? a.tadId : '',
      tab: TAB_BY_KIND.adr,
    });
  }

  const bs = model?.bs;
  if (bs?.bsId) {
    rows.push({
      id: bs.bsId,
      kind: 'bs',
      title: typeof bs.title === 'string' ? bs.title : '',
      snippet: snippetOf(bs.buildPhilosophy ?? ''),
      parent: typeof bs.prdId === 'string' ? bs.prdId : '',
      tab: TAB_BY_KIND.bs,
    });
  }

  for (const f of model?.fbsItems ?? []) {
    if (!f?.fbsId) continue;
    rows.push({
      id: f.fbsId,
      kind: 'fbs',
      title: typeof f.title === 'string' ? f.title : '',
      snippet: snippetOf(f.summary ?? ''),
      parent: typeof f.bsId === 'string' ? f.bsId : '',
      tab: TAB_BY_KIND.fbs,
    });
  }

  for (const ts of model?.testSuites ?? []) {
    const id = ts?.id ?? ts?.tsId;
    if (!id) continue;
    rows.push({
      id,
      kind: 'ts',
      title: typeof ts.title === 'string' ? ts.title : '',
      snippet: snippetOf(ts.purpose ?? ''),
      parent: typeof ts.usId === 'string' ? ts.usId : '',
      tab: TAB_BY_KIND.ts,
    });
  }

  return { rows };
}

/**
 * Build the JSON string the server returns on `GET /index.json`. Kept
 * next to buildViewIndex so the Content-Length can be set from the
 * byte length of the exact string the client receives.
 *
 * @param {import('./tree-model.js').BuiltTreeModel} model
 * @returns {string}
 */
export function serialiseViewIndex(model) {
  return JSON.stringify(buildViewIndex(model));
}

/**
 * Pure ranking helper mirrored into page-init.js's wireLookup. Kept
 * here so the server-side tests can exercise the exact ranking rules
 * the browser applies. Design doc section 6 rules:
 *   - A single-character query searches ids only; the title / snippet
 *     word-match pass is skipped.
 *   - Otherwise ids rank first (exact > prefix > contains).
 *   - Then every query word must match title or snippet, title above
 *     snippet.
 *   - 20 results max; stable by id on ties.
 *
 * @param {string} query
 * @param {IndexRow[]} rows
 * @returns {Array<{ row: IndexRow, score: number, needles: string[] }>}
 */
export function rankLookupRows(query, rows) {
  if (!query || !Array.isArray(rows)) return [];
  const q = String(query).trim().toLowerCase();
  if (!q) return [];
  const scored = [];
  if (q.length === 1) {
    for (const r of rows) {
      const idLow = (r.id || '').toLowerCase();
      if (idLow.indexOf(q) === -1) continue;
      let score = 100;
      if (idLow === q) score = 1000;
      else if (idLow.indexOf(q) === 0) score = 500;
      scored.push({ row: r, score, needles: [q] });
    }
  } else {
    const words = q.split(/\s+/).filter(Boolean);
    for (const r of rows) {
      const idLow = (r.id || '').toLowerCase();
      const titleLow = (r.title || '').toLowerCase();
      const snipLow = (r.snippet || '').toLowerCase();
      let score = 0;
      if (idLow === q) score = 10000;
      else if (idLow.indexOf(q) === 0) score = 5000;
      else if (idLow.indexOf(q) !== -1) score = 2500;
      else {
        let titleHits = 0;
        let snipHits = 0;
        let allHit = true;
        for (const w of words) {
          const inTitle = titleLow.indexOf(w) !== -1;
          const inSnip = snipLow.indexOf(w) !== -1;
          if (inTitle) titleHits += 1;
          else if (inSnip) snipHits += 1;
          else { allHit = false; break; }
        }
        if (!allHit) continue;
        score = 1000 + titleHits * 50 + snipHits * 10;
      }
      if (score > 0) scored.push({ row: r, score, needles: words });
    }
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (a.row.id || '').localeCompare(b.row.id || '');
  });
  return scored.slice(0, 20);
}

/**
 * The LookupModal shell HTML. Rendered once at the top of the shell
 * (outside #rcf-live-content so the SSE innerHTML swap cannot blow it
 * away). The modal is hidden by default; wireLookup toggles it. The
 * results list is rendered client-side after the index fetch resolves,
 * so this emits only the input, the status / empty-state slot, the
 * reload affordance and the live-region hooks screen readers expect.
 *
 * No `<div>` tags are used: the toast container uses `<output>` for
 * exactly this reason - the Phase 3.8 D13a shell invariant checked by
 * `test/view/html-page.test.js` reads the last `</div>` to find the
 * live-content wrapper close, so the modal uses semantic elements
 * (`<aside>` / `<section>` / `<header>` / `<ul>` / `<p>`) throughout.
 *
 * @returns {string}
 */
export function renderLookupModal() {
  return `<aside class="rcf-lookup" data-rcf-lookup hidden role="dialog" aria-modal="true" aria-labelledby="rcf-lookup-title">
  <button type="button" class="rcf-lookup-backdrop" data-rcf-lookup-backdrop aria-label="Close id lookup backdrop" tabindex="-1"></button>
  <section class="rcf-lookup-panel" role="document">
    <header class="rcf-lookup-head">
      <h2 id="rcf-lookup-title" class="rcf-lookup-heading">Find any document or AC</h2>
      <button type="button" class="rcf-lookup-close" data-rcf-lookup-close aria-label="Close id lookup">Close</button>
    </header>
    <label class="rcf-lookup-field">
      <span class="rcf-lookup-label">Type an id or title</span>
      <input type="text" class="rcf-lookup-input" data-rcf-lookup-input
             autocomplete="off" spellcheck="false" aria-controls="rcf-lookup-results"
             aria-describedby="rcf-lookup-status" placeholder="REQ-002, US-304, LookupModal, ...">
    </label>
    <p class="rcf-lookup-status" id="rcf-lookup-status" data-rcf-lookup-status role="status" aria-live="polite"></p>
    <ul class="rcf-lookup-results" id="rcf-lookup-results" data-rcf-lookup-results role="listbox" aria-label="Lookup results"></ul>
    <section class="rcf-lookup-empty" data-rcf-lookup-empty hidden>
      <p class="rcf-lookup-empty-msg" data-rcf-lookup-empty-msg>No matches.</p>
      <button type="button" class="rcf-lookup-reload" data-rcf-lookup-reload hidden>Reload index</button>
    </section>
  </section>
</aside>`;
}

/**
 * The SearchButton for the shell's `<div class="tools">`. One
 * <button> with a search mark glyph; opens the LookupModal on click.
 * Carries the Cmd/Ctrl+F mnemonic in the title/aria-label so a
 * keyboard-first reader knows the shortcut.
 *
 * @returns {string}
 */
export function renderSearchButton() {
  return `<button type="button" class="rcf-search-btn" data-rcf-search
          aria-label="Find any document or AC (Cmd/Ctrl+F)"
          title="Find any document or AC (Cmd/Ctrl+F)">
  <svg class="rcf-search-icon" aria-hidden="true" viewBox="0 0 20 20" width="16" height="16">
    <circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" stroke-width="1.8"/>
    <path d="M13.5 13.5l4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  </svg>
  <span class="rcf-search-label">Find</span>
  <span class="rcf-search-kbd" aria-hidden="true"><kbd>Ctrl</kbd>+<kbd>F</kbd></span>
</button>`;
}
