// Shell header polish (viewer UI refresh PR 2, decision 17 + Baz
// 2026-10-02 brief): project name sourced from manifest.projectName,
// then prd.productName, then prd.productTitle; optional stack chip
// from tad.stack or tad.systemOverview.stack. When neither is set the
// product block collapses silently (CSS .product:empty { display:none }).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderPage, resolveProductHeader } from '../../src/view/html-page.js';

function emptyModel(over = {}) {
  return {
    manifest: null,
    prd: null,
    tad: null,
    bs: null,
    requirements: [],
    userStories: [],
    tacs: [],
    adrs: [],
    fbsItems: [],
    testSuites: [],
    byId: new Map(),
    rawById: new Map(),
    brokenIds: new Set(),
    parentByChild: new Map(),
    childrenByParent: new Map(),
    dependentsByFbsId: new Map(),
    tsByAcId: new Map(),
    tcsByAcId: new Map(),
    usByTacId: new Map(),
    storiesByReqId: new Map(),
    fbsByAcId: new Map(),
    acIdsByUsId: new Map(),
    usByAcId: new Map(),
    errorsById: new Map(),
    errors: [],
    codeNodes: [],
    cnByAcId: new Map(),
    ...over,
  };
}

// ---------------------------------------------------------------------
// resolveProductHeader
// ---------------------------------------------------------------------

test('resolveProductHeader: manifest.projectName wins', () => {
  const header = resolveProductHeader(emptyModel({
    manifest: { projectName: 'WESPA' },
    prd: { productName: 'Should not win', productTitle: 'Nor this' },
  }));
  assert.equal(header.projectName, 'WESPA');
});

test('resolveProductHeader: prd.productName is the first fallback', () => {
  const header = resolveProductHeader(emptyModel({
    prd: { productName: 'From PRD', productTitle: 'From title' },
  }));
  assert.equal(header.projectName, 'From PRD');
});

test('resolveProductHeader: prd.productTitle is the last fallback', () => {
  const header = resolveProductHeader(emptyModel({
    prd: { productTitle: 'The PRD title the brief names' },
  }));
  assert.equal(header.projectName, 'The PRD title the brief names');
});

test('resolveProductHeader: nothing set returns null, not an empty string', () => {
  const header = resolveProductHeader(emptyModel());
  assert.equal(header.projectName, null);
  assert.equal(header.stack, null);
});

test('resolveProductHeader: tad.stack renders as the stack chip', () => {
  const header = resolveProductHeader(emptyModel({ tad: { stack: 'Node 24 ESM' } }));
  assert.equal(header.stack, 'Node 24 ESM');
});

test('resolveProductHeader: tad.systemOverview.stack is the fallback stack source', () => {
  const header = resolveProductHeader(emptyModel({
    tad: { systemOverview: { stack: 'Rust + wasm' } },
  }));
  assert.equal(header.stack, 'Rust + wasm');
});

test('resolveProductHeader: empty-string stack is treated as no stack', () => {
  const header = resolveProductHeader(emptyModel({
    tad: { stack: '', systemOverview: { stack: '' } },
  }));
  assert.equal(header.stack, null);
});

// ---------------------------------------------------------------------
// renderPage header DOM
// ---------------------------------------------------------------------

test('renderPage: project name is the prominent text, review surface muted beside it', () => {
  const html = renderPage(emptyModel({ manifest: { projectName: 'WESPA' } }));
  assert.match(
    html,
    /<div class="product"><span class="name">WESPA<\/span>\s*<span class="sub">review surface<\/span><\/div>/,
  );
});

test('renderPage: optional stack chip renders beside the project name when the TAD names one', () => {
  const html = renderPage(emptyModel({
    manifest: { projectName: 'WESPA' },
    tad: { stack: 'Node 24 ESM' },
  }));
  assert.match(html, /<span class="name">WESPA<\/span>/);
  assert.match(html, /<span class="stack" title="Stack under review">Node 24 ESM<\/span>/);
  // Order: name first, stack after.
  const nameIdx = html.indexOf('class="name"');
  const stackIdx = html.indexOf('class="stack"');
  assert.ok(nameIdx > 0 && stackIdx > nameIdx, 'stack chip should render after the project name');
});

test('renderPage: product block collapses to an empty div when there is no name and no stack', () => {
  const html = renderPage(emptyModel());
  // Neither name, sub, nor stack chip rendered.
  assert.doesNotMatch(html, /<span class="name">/);
  assert.doesNotMatch(html, /<span class="sub">/);
  assert.doesNotMatch(html, /<span class="stack"/);
  // CSS targets .product:empty for the silent collapse.
  assert.match(html, /<div class="product"><\/div>/);
});

test('renderPage: stack chip survives embed=1 (handled on the client, no page-level change)', () => {
  // The header always renders the stack chip when the TAD names one;
  // the Dex / wespa embed contract keeps the project name under
  // data-embed="1" and so keeps the stack with it.
  const html = renderPage(emptyModel({
    manifest: { projectName: 'WESPA' },
    tad: { stack: 'Node' },
  }));
  assert.match(html, /class="stack"/);
});

test('renderPage: project name is HTML-escaped', () => {
  const html = renderPage(emptyModel({ manifest: { projectName: '<script>' } }));
  assert.match(html, /<span class="name">&lt;script&gt;<\/span>/);
  assert.doesNotMatch(html, /<span class="name"><script><\/span>/);
});

test('renderPage: Toast container is mounted exactly once in the shell', () => {
  const html = renderPage(emptyModel());
  const matches = html.match(/<output class="rcf-toast toast"/g) ?? [];
  assert.equal(matches.length, 1);
});

test('renderPage: page-init.js carries the shared showToast helper (window.rcfView)', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { resolve, dirname } = await import('node:path');
  const here = dirname(fileURLToPath(import.meta.url));
  const script = await readFile(resolve(here, '..', '..', 'src', 'view', 'page-init.js'), 'utf8');
  assert.match(script, /window\.rcfView\.showToast/);
  assert.match(script, /\[data-toast\]/);
});
