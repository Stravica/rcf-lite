// Viewer UI refresh PR 7 (TAC-4132, ADR-4134): coverage for the ID
// lookup index projection, the LookupModal + SearchButton shell
// markup, the shell wiring in html-page.js, the page-init.js wireLookup
// contract and the GET /index.json server route. Builds against the
// live dogfood tree.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { walkTree } from '#core/store';
import { renderPage } from '../../src/view/html-page.js';
import { buildTreeModel } from '../../src/view/tree-model.js';
import { buildViewIndex, serialiseViewIndex, renderLookupModal, renderSearchButton, rankLookupRows } from '../../src/view/view-index.js';
import { renderModelToPage } from '../../src/view/index.js';
import { createRouter } from '../../src/server/routes.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

async function builtModel() {
  const result = await walkTree({ projectRoot: repoRoot });
  return buildTreeModel(result);
}

test('buildViewIndex emits one row per document plus one row per AC with the required shape', async () => {
  const model = await builtModel();
  const { rows } = buildViewIndex(model);
  assert.ok(Array.isArray(rows));
  assert.ok(rows.length > 100, `expected many rows, got ${rows.length}`);
  for (const row of rows) {
    for (const key of ['id', 'kind', 'title', 'snippet', 'parent', 'tab']) {
      assert.ok(Object.prototype.hasOwnProperty.call(row, key), `row ${row.id} missing key "${key}"`);
      assert.equal(typeof row[key], 'string');
    }
    assert.ok(['prd', 'req', 'us', 'ac', 'tad', 'tac', 'adr', 'bs', 'fbs', 'ts'].includes(row.kind));
    assert.ok(['overview', 'requirements', 'architecture', 'build'].includes(row.tab));
    assert.ok(row.snippet.length <= 110, `snippet "${row.snippet}" is ${row.snippet.length} chars, over 110`);
  }
});

test('buildViewIndex includes every document kind present on the dogfood tree and every US AC', async () => {
  const model = await builtModel();
  const { rows } = buildViewIndex(model);
  const byId = new Map(rows.map((r) => [r.id, r]));
  // Sample a REQ, US and AC.
  const req002 = byId.get('REQ-002');
  assert.ok(req002, 'REQ-002 row present');
  assert.equal(req002.kind, 'req');
  assert.equal(req002.tab, 'requirements');
  assert.equal(req002.parent, 'PRD-001');

  const us205 = byId.get('US-205');
  assert.ok(us205, 'US-205 row present');
  assert.equal(us205.kind, 'us');
  assert.equal(us205.parent, 'REQ-002');
  assert.equal(us205.tab, 'requirements');

  const ac205_1 = byId.get('AC-205-1');
  assert.ok(ac205_1, 'AC-205-1 row present');
  assert.equal(ac205_1.kind, 'ac');
  assert.equal(ac205_1.parent, 'US-205');
  assert.equal(ac205_1.tab, 'requirements');

  // Every AC on US-205 is a row.
  const us205Doc = model.userStories.find((u) => u.usId === 'US-205');
  for (const ac of us205Doc.acceptanceCriteria) {
    assert.ok(byId.has(ac.id), `AC ${ac.id} should be in the index`);
  }

  // A TAC lands in Architecture.
  const tac4132 = byId.get('TAC-4132-id-lookup');
  assert.ok(tac4132, 'TAC-4132-id-lookup row present');
  assert.equal(tac4132.kind, 'tac');
  assert.equal(tac4132.tab, 'architecture');

  // The ADR authored in PR 7.
  const adr4134 = byId.get('ADR-4134-index-json-route');
  assert.ok(adr4134, 'ADR-4134 row present');
  assert.equal(adr4134.kind, 'adr');
  assert.equal(adr4134.tab, 'architecture');

  // An FBS lands in Build.
  const anyFbs = rows.find((r) => r.kind === 'fbs');
  assert.ok(anyFbs, 'at least one FBS row');
  assert.equal(anyFbs.tab, 'build');

  // PRD lands in overview.
  const prd = rows.find((r) => r.kind === 'prd');
  assert.ok(prd);
  assert.equal(prd.tab, 'overview');
});

test('buildViewIndex row count is in the dogfood design envelope (roughly a thousand rows)', async () => {
  const model = await builtModel();
  const { rows } = buildViewIndex(model);
  // Design doc section 6 cites "roughly 1,600 rows on the dogfood
  // tree". The exact count moves with the tree; assert a wide envelope
  // that still catches a projection regression (e.g. dropping ACs).
  assert.ok(rows.length > 1000, `expected > 1000 rows, got ${rows.length}`);
  assert.ok(rows.length < 3000, `expected < 3000 rows, got ${rows.length}`);
  // AC rows are the plurality on the dogfood tree.
  const acRows = rows.filter((r) => r.kind === 'ac');
  assert.ok(acRows.length > 400, `expected many AC rows, got ${acRows.length}`);
});

test('buildViewIndex snippet is whitespace-collapsed and capped at 110 chars', async () => {
  const model = await builtModel();
  const { rows } = buildViewIndex(model);
  const prd = rows.find((r) => r.kind === 'prd');
  assert.ok(prd);
  // No raw newlines or runs of whitespace in the snippet.
  assert.doesNotMatch(prd.snippet, /\n/);
  assert.doesNotMatch(prd.snippet, /  /);
  // The snippet is cut, not padded.
  assert.ok(prd.snippet.length <= 110);
});

test('serialiseViewIndex returns a JSON string under 400 KB on the dogfood tree', async () => {
  const model = await builtModel();
  const json = serialiseViewIndex(model);
  assert.equal(typeof json, 'string');
  const parsed = JSON.parse(json);
  assert.ok(Array.isArray(parsed.rows));
  // Design doc section 6 cites "under 300 KB". Allow a 400 KB envelope
  // to catch a serialisation regression without flaking on a tree that
  // happens to pick up a few more rows.
  const bytes = Buffer.byteLength(json);
  assert.ok(bytes < 400 * 1024, `expected index JSON under 400 KB, got ${bytes} bytes`);
});

test('renderSearchButton emits a <button> with the data-rcf-search hook and the Cmd/Ctrl+F mnemonic', () => {
  const html = renderSearchButton();
  assert.match(html, /<button[^>]*data-rcf-search[^>]*>/);
  assert.match(html, /aria-label="Find any document or AC \(Cmd\/Ctrl\+F\)"/);
  assert.match(html, /class="rcf-search-icon"/);
});

test('renderLookupModal uses no <div> tags so the shell lastIndexOf("</div>") invariant stays intact', () => {
  const html = renderLookupModal();
  assert.doesNotMatch(html, /<div\b/);
  assert.doesNotMatch(html, /<\/div>/);
  assert.match(html, /<aside[^>]*data-rcf-lookup[^>]*hidden[^>]*>/);
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /data-rcf-lookup-input/);
  assert.match(html, /data-rcf-lookup-results/);
  assert.match(html, /data-rcf-lookup-close/);
  assert.match(html, /data-rcf-lookup-backdrop/);
  assert.match(html, /data-rcf-lookup-reload/);
  assert.match(html, /role="listbox"/);
});

test('renderPage mounts the SearchButton inside the shell tools and the LookupModal outside #rcf-live-content', async () => {
  const model = await builtModel();
  const html = renderPage(model);
  assert.match(html, /<div class="tools" aria-label="Viewer tools">[\s\S]*?<button[^>]*data-rcf-search/);
  // The modal sits after the live-content wrapper so the SSE innerHTML
  // swap cannot blow it away. The TAC-4132 description also mentions
  // data-rcf-lookup, so match on the modal's unique root marker.
  const liveClose = html.lastIndexOf('</div>');
  const modalOpen = html.indexOf('<aside class="rcf-lookup"');
  assert.ok(modalOpen > liveClose, `LookupModal (<aside class="rcf-lookup">) at ${modalOpen} must open after the live-content wrapper closes at ${liveClose}`);
  // The modal is rendered exactly once in the shell.
  assert.equal((html.match(/<aside class="rcf-lookup"/g) || []).length, 1);
  // No regression on the shell's single-live-content-wrapper invariant.
  assert.equal((html.match(/<div id="rcf-live-content">/g) || []).length, 1);
});

test('page-init.js carries the wireLookup contract: Cmd/Ctrl+F binding, lazy fetch, up/down/Enter/Esc', async () => {
  const script = readFileSync(resolve(repoRoot, 'src/view/page-init.js'), 'utf8');
  assert.match(script, /function wireLookup/);
  assert.match(script, /\.\/index\.json/);
  assert.match(script, /__rcfLookupDirty/);
  // The Cmd/Ctrl+F binding is explicit about Shift being skipped.
  assert.match(script, /ev\.ctrlKey \|\| ev\.metaKey/);
  assert.match(script, /if \(ev\.shiftKey\) return/);
  // writeHash is used on pick so the embed and theme query survive.
  assert.match(script, /writeHash\(['"]#tab=['"] \+ encodeURIComponent\(tab\) \+ ['"]&entity=['"] \+ encodeURIComponent\(id\)/);
  // Keyboard navigation keys.
  assert.match(script, /ev\.key === ['"]ArrowDown['"]/);
  assert.match(script, /ev\.key === ['"]ArrowUp['"]/);
  assert.match(script, /ev\.key === ['"]Enter['"]/);
  assert.match(script, /ev\.key === ['"]Escape['"]/);
});

test('page-init.js does not add outbound postMessage, localStorage, sessionStorage or cookies in the lookup wiring (AC-205-8)', async () => {
  const script = readFileSync(resolve(repoRoot, 'src/view/page-init.js'), 'utf8');
  const lookupStart = script.indexOf('ID lookup (viewer UI refresh PR 7');
  assert.ok(lookupStart > 0, 'lookup section is marked');
  const lookupEnd = script.indexOf('var hashchangeWired', lookupStart);
  const lookupSection = script.slice(lookupStart, lookupEnd);
  assert.doesNotMatch(lookupSection, /postMessage/);
  assert.doesNotMatch(lookupSection, /localStorage/);
  assert.doesNotMatch(lookupSection, /sessionStorage/);
  assert.doesNotMatch(lookupSection, /document\.cookie/);
});

test('live-client.js sets __rcfLookupDirty on tree-update so the next modal open refetches', async () => {
  const script = readFileSync(resolve(repoRoot, 'src/view/live-client.js'), 'utf8');
  assert.match(script, /__rcfLookupDirty\s*=\s*true/);
});

test('renderModelToPage returns an indexJson string alongside pmPartials', async () => {
  const result = await renderModelToPage({ projectRoot: repoRoot });
  assert.equal(typeof result.indexJson, 'string');
  const parsed = JSON.parse(result.indexJson);
  assert.ok(Array.isArray(parsed.rows));
});

test('server /index.json 200s with { rows } when the state carries indexJson; 503s before the first walk', async () => {
  const indexJson = JSON.stringify({ rows: [{ id: 'REQ-002', kind: 'req', title: 't', snippet: 's', parent: 'PRD-001', tab: 'requirements' }] });
  let state = null;
  const router = createRouter({
    currentState: () => state,
    sse: { handle() {} },
    stylePath: '/dev/null',
    mermaidPath: '/dev/null',
    liveClientPath: '/dev/null',
    pageInitPath: '/dev/null',
  });
  // Before first walk: 503.
  const resInit = makeMockRes();
  router({ method: 'GET', url: '/index.json' }, resInit);
  assert.equal(resInit.statusCode, 503);

  state = { version: 1, fullPageHtml: '', contentHtml: '', indexJson };
  const resOk = makeMockRes();
  router({ method: 'GET', url: '/index.json' }, resOk);
  assert.equal(resOk.statusCode, 200);
  assert.equal(resOk.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(resOk.headers['cache-control'], 'no-store');
  assert.equal(resOk.body, indexJson);
  const payload = JSON.parse(resOk.body);
  assert.deepEqual(payload.rows[0].id, 'REQ-002');
});

function makeMockRes() {
  const res = {
    statusCode: 0,
    headers: {},
    body: '',
    writeHead(code, headers) {
      this.statusCode = code;
      Object.assign(this.headers, headers || {});
    },
    end(body) {
      if (typeof body === 'string') this.body = body;
      else if (Buffer.isBuffer(body)) this.body = body.toString('utf8');
    },
    on() {},
    off() {},
  };
  return res;
}

// ---- rankLookupRows: design doc section 6 ranking rules ----

const RANK_FIXTURE = [
  { id: 'REQ-002', kind: 'req', title: 'Visual review surface', snippet: 'the viewer renders every document', parent: 'PRD-001', tab: 'requirements' },
  { id: 'REQ-012', kind: 'req', title: 'Alignment of blueprints', snippet: 'review the alignment', parent: 'PRD-001', tab: 'requirements' },
  { id: 'US-205', kind: 'us', title: 'An engineer jumps to any document or AC by id', snippet: 'opens the LookupModal with type-ahead', parent: 'REQ-002', tab: 'requirements' },
  { id: 'TAC-4132-id-lookup', kind: 'tac', title: 'ID lookup', snippet: 'the LookupModal with type-ahead over a server-built index', parent: 'TAD-001', tab: 'architecture' },
  { id: 'TAC-4131-build-dag-view', kind: 'tac', title: 'Build DAG view', snippet: 'DAG canvas with inspector and filters', parent: 'TAD-001', tab: 'architecture' },
  { id: 'AC-205-1', kind: 'ac', title: '', snippet: 'opening the modal and typing an exact id ranks that id first', parent: 'US-205', tab: 'requirements' },
];

test('rankLookupRows: exact id ranks first (AC-205-1)', () => {
  const results = rankLookupRows('REQ-002', RANK_FIXTURE);
  assert.ok(results.length > 0);
  assert.equal(results[0].row.id, 'REQ-002');
});

test('rankLookupRows: prefix id ranks the right doc first', () => {
  const results = rankLookupRows('REQ-00', RANK_FIXTURE);
  assert.equal(results[0].row.id, 'REQ-002');
});

test('rankLookupRows: a title match ranks above a snippet-only match (AC-205-2)', () => {
  // Word "lookup": TAC-4132 has it in its title ("ID lookup") and
  // snippet; US-205 has it in snippet only (via "LookupModal").
  const results = rankLookupRows('lookup', RANK_FIXTURE);
  const titleHitIdx = results.findIndex((r) => r.row.id === 'TAC-4132-id-lookup');
  const snipHitIdx = results.findIndex((r) => r.row.id === 'US-205');
  assert.ok(titleHitIdx !== -1 && snipHitIdx !== -1);
  assert.ok(titleHitIdx < snipHitIdx, `expected TAC-4132 above US-205, got order: ${results.map((r) => r.row.id).join(', ')}`);
});

test('rankLookupRows: single-character queries search ids only (AC-205-3)', () => {
  // "A" matches every AC-* id, but should NOT match any title or snippet.
  const results = rankLookupRows('a', RANK_FIXTURE);
  for (const r of results) {
    assert.ok(r.row.id.toLowerCase().includes('a'), `single-char search returned id ${r.row.id} without "a" in the id`);
  }
  // The AC in the fixture carries "a" in its id.
  assert.ok(results.some((r) => r.row.id === 'AC-205-1'));
  // A row whose id has no "a" but whose title or snippet does must NOT appear.
  assert.ok(!results.some((r) => r.row.id === 'US-205'));
});

test('rankLookupRows: results are capped at 20', () => {
  const many = [];
  for (let i = 0; i < 50; i += 1) many.push({ id: `REQ-${String(100 + i).padStart(3, '0')}`, kind: 'req', title: 'foo', snippet: '', parent: '', tab: 'requirements' });
  const results = rankLookupRows('REQ', many);
  assert.equal(results.length, 20);
});

test('rankLookupRows: a word query against no match returns an empty list', () => {
  const results = rankLookupRows('zzznonexistent', RANK_FIXTURE);
  assert.equal(results.length, 0);
});

test('rankLookupRows: a multi-word query only ranks rows where every word matches', () => {
  const results = rankLookupRows('visual review', RANK_FIXTURE);
  // Only REQ-002 has both "visual" and "review" (via title "Visual review surface").
  assert.ok(results.some((r) => r.row.id === 'REQ-002'));
  // REQ-012 has only "review" (in title + snippet), not "visual".
  assert.ok(!results.some((r) => r.row.id === 'REQ-012'));
});

test('rankLookupRows: an empty / whitespace query returns an empty list', () => {
  assert.deepEqual(rankLookupRows('', RANK_FIXTURE), []);
  assert.deepEqual(rankLookupRows('   ', RANK_FIXTURE), []);
});

test('CHANGELOG release-notes the new ./index.json route (ADR-4134)', async () => {
  const path = resolve(repoRoot, 'CHANGELOG.md');
  const text = readFileSync(path, 'utf8');
  assert.match(text, /\.\/index\.json/);
  assert.match(text, /viewer route is `\.\/index\.json`/);
});

test('page-init.js urlWithHash preserves ?tab=&entity= + any other query at mount (AC-205-5)', () => {
  const script = readFileSync(resolve(repoRoot, 'src/view/page-init.js'), 'utf8');
  // urlWithHash concatenates location.pathname + location.search before the hash,
  // so a mount URL like /?tab=requirements&entity=US-304 keeps its query untouched
  // through every hash write and the Router honours the current hash on first paint.
  assert.match(script, /function urlWithHash/);
  assert.match(script, /window\.location\.pathname \+ window\.location\.search/);
  // resolveHash runs on mount so an initial hash (set from query by the host or
  // by the server-rendered page) opens the right tab + entity.
  assert.match(script, /function resolveHash/);
});

test('page-init.js writeHash preserves ?embed= and ?theme= through every pick (AC-205-6)', () => {
  const script = readFileSync(resolve(repoRoot, 'src/view/page-init.js'), 'utf8');
  // writeHash goes through urlWithHash which carries location.search verbatim;
  // Dex contract on PR 1. The LookupModal pick uses writeHash, so ?embed=1&theme=dark
  // survives the hash change.
  assert.match(script, /function writeHash/);
  // urlWithHash explicitly preserves location.search (where ?embed= / ?theme= live).
  const uw = script.indexOf('function urlWithHash');
  const uwEnd = script.indexOf('\n  }', uw);
  const uwBody = script.slice(uw, uwEnd);
  assert.match(uwBody, /window\.location\.search/);
});

test('renderLookupModal carries the empty-state + reload affordance markers (AC-205-7)', () => {
  const html = renderLookupModal();
  // The empty state and the reload button are both present in the shell so
  // wireLookup can show them when ./index.json 404s or returns malformed JSON.
  assert.match(html, /data-rcf-lookup-empty/);
  assert.match(html, /data-rcf-lookup-reload/);
});

test('page-init.js bootHashFromQuery promotes ?tab=&entity= into the hash at mount (AC-205-5)', () => {
  const script = readFileSync(resolve(repoRoot, 'src/view/page-init.js'), 'utf8');
  assert.match(script, /function bootHashFromQuery/);
  // Promotes tab + sub + entity from the query into the hash, so the
  // existing hash-router honours a mount URL like ?tab=requirements&entity=US-304.
  const start = script.indexOf('function bootHashFromQuery');
  const end = script.indexOf('\n  }', start);
  const body = script.slice(start, end);
  assert.match(body, /q\.tab/);
  assert.match(body, /q\.entity/);
  assert.match(body, /q\.sub/);
  assert.match(body, /if \(window\.location\.hash\) return/);
  // onReady calls bootHashFromQuery after initShellFromQuery and
  // before resolveHash so the first paint lands on the right position.
  const ready = script.indexOf('function onReady');
  const readyEnd = script.indexOf('\n  }', ready);
  assert.match(script.slice(ready, readyEnd), /initShellFromQuery\(\);\s*\n\s*bootHashFromQuery\(\);/);
});

test('page-init.js lookupPick re-routes a TS pick to its owning US (design decision 6)', () => {
  const script = readFileSync(resolve(repoRoot, 'src/view/page-init.js'), 'utf8');
  const start = script.indexOf('function lookupPick');
  const end = script.indexOf('\n  }', start);
  const body = script.slice(start, end);
  // A TS row carries parent=US-id; the pick swaps id to the parent US
  // and tab to requirements so the Router opens the owning US where the
  // TS card renders. Decision 6 moved TS out of the Build tab.
  assert.match(body, /kind === 'ts'/);
  assert.match(body, /tab = 'requirements'/);
});

test('page-init.js resolveHash flashes the target after scroll (AC-205-4, design section 6)', () => {
  const script = readFileSync(resolve(repoRoot, 'src/view/page-init.js'), 'utf8');
  assert.match(script, /function flashLookupTarget/);
  // flashLookupTarget is called after scrollIntoView in both resolveHash
  // branches (the #tab=&entity= branch and the bare #id branch).
  assert.ok(
    (script.match(/scrollIntoView\(.+\); \} catch \(e\) \{ ent\.scrollIntoView\(\); \}\n\s*flashLookupTarget\(ent\);/g) || []).length >= 1,
    'flashLookupTarget called after the #tab=&entity= scroll'
  );
  assert.ok(
    (script.match(/scrollIntoView\(.+\); \} catch \(e\) \{ target\.scrollIntoView\(\); \}\n\s*flashLookupTarget\(target\);/g) || []).length >= 1,
    'flashLookupTarget called after the bare-hash scroll'
  );
});

test('style.css adds the rcfLookupFlash keyframes + .is-rcf-lookup-flash class', () => {
  const css = readFileSync(resolve(repoRoot, 'src/view/style.css'), 'utf8');
  assert.match(css, /@keyframes rcfLookupFlash/);
  assert.match(css, /\.is-rcf-lookup-flash\s*\{[^}]*rcfLookupFlash/);
});

test('wireLookup row markup carries data-rcf-lookup-kind + data-rcf-lookup-parent so TS re-routing works', () => {
  const script = readFileSync(resolve(repoRoot, 'src/view/page-init.js'), 'utf8');
  assert.match(script, /data-rcf-lookup-kind="/);
  assert.match(script, /data-rcf-lookup-parent="/);
});
