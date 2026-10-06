// Shell header layout fix (issue 295, w-2026-10-06-dave-001). The audit
// header must keep every main tab visible at any viewport the chrome
// supports, with .product truncating first (ellipsis) and the tablist
// plus .tools holding their intrinsic width. Dex (WSD) reported Build
// clipped and the Find button overlapping it on the WESPA tree
// (projectName 54 characters). The repo does not use a headless browser
// so we pin the fix via two static shapes: (a) the layout rules in
// style.css, and (b) the title attribute carrying the full name in the
// server-rendered HTML.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderPage } from '../../src/view/html-page.js';

const here = dirname(fileURLToPath(import.meta.url));
const stylePath = resolve(here, '..', '..', 'src', 'view', 'style.css');

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

// Extract the property block for a CSS selector. The style sheet is
// hand-maintained CSS with one rule per block; a simple brace-balanced
// walk is enough and keeps us out of the business of a CSS parser.
// We strip /* ... */ comments from the returned block so property
// matchers do not false-positive on prose in a comment.
function propertyBlockFor(css, selector) {
  const idx = css.indexOf(selector);
  if (idx < 0) return null;
  const openBrace = css.indexOf('{', idx);
  if (openBrace < 0) return null;
  let depth = 1;
  let i = openBrace + 1;
  while (i < css.length && depth > 0) {
    const ch = css[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    i += 1;
  }
  const raw = css.slice(openBrace + 1, i - 1);
  return raw.replace(/\/\*[\s\S]*?\*\//g, '');
}

// Baz's expected behaviour (brief): tabs never shrink; .tools never
// shrinks; .product carries min-width 0 so it can yield; .product .name
// carries min-width 0 so the ellipsis actually triggers inside the flex
// container. These selectors are the fulcrum the brief names; a
// regression that lifts any one of them re-opens the bug.

test('AC-202-4: nav.tabs cannot shrink below its intrinsic width', async () => {
  const css = await readFile(stylePath, 'utf8');
  const block = propertyBlockFor(css, 'nav.tabs ');
  assert.ok(block, 'nav.tabs rule block missing from style.css');
  // Either a shorthand that pins shrink to 0, or an explicit flex-shrink: 0.
  const shrinkZero = /flex\s*:\s*\d+\s+0\s+/.test(block)
    || /flex-shrink\s*:\s*0/.test(block);
  assert.ok(
    shrinkZero,
    `nav.tabs must have flex-shrink: 0 so the tablist never clips; got:\n${block}`,
  );
  // The shrinkable guard the old rule carried (min-width: 0) is removed
  // in step; the only path to a shrunken tablist used to go through it.
  const minWidthZero = /(^|[^-])min-width\s*:\s*0\b/.test(block);
  assert.equal(
    minWidthZero, false,
    `nav.tabs must not allow a sub-intrinsic width via min-width:0; got:\n${block}`,
  );
});

test('AC-202-4: .tools cannot shrink below its intrinsic width', async () => {
  const css = await readFile(stylePath, 'utf8');
  const block = propertyBlockFor(css, '.tools ');
  assert.ok(block, '.tools rule block missing from style.css');
  const shrinkZero = /flex-shrink\s*:\s*0/.test(block)
    || /flex\s*:\s*\d+\s+0\s+/.test(block);
  assert.ok(shrinkZero, `.tools must have flex-shrink: 0; got:\n${block}`);
});

test('AC-202-4: .product yields first via min-width:0', async () => {
  const css = await readFile(stylePath, 'utf8');
  const block = propertyBlockFor(css, '.product ');
  assert.ok(block, '.product rule block missing from style.css');
  assert.match(
    block, /min-width\s*:\s*0/,
    `.product must have min-width:0 so it yields to the tablist/tools`,
  );
});

test('AC-202-4: .product .name has min-width:0 so the ellipsis triggers', async () => {
  const css = await readFile(stylePath, 'utf8');
  const block = propertyBlockFor(css, '.product .name ');
  assert.ok(block, '.product .name rule block missing from style.css');
  assert.match(
    block, /min-width\s*:\s*0/,
    `.product .name must have min-width:0 so text-overflow:ellipsis actually applies`,
  );
  // The existing ellipsis chain stays in place.
  assert.match(block, /overflow\s*:\s*hidden/);
  assert.match(block, /text-overflow\s*:\s*ellipsis/);
});

// The ellipsis is useful only if hover reveals the full name. The .name
// span therefore carries title="<full name>" on every render; the
// product block that collapses (no projectName) has no .name span and
// so no title.

test('AC-202-5: renderPage emits title="<full name>" on .product .name', () => {
  const long = 'WESPA - WSD Enterprise Semantic Platform for Analytics';
  const html = renderPage(emptyModel({
    prd: { productName: long },
  }));
  assert.match(
    html,
    new RegExp(`<span class="name" title="${long}">${long}</span>`),
    'the full project name must ride along as a title attribute on .name',
  );
});

test('AC-202-5: the title attribute is HTML-escaped alongside the body', () => {
  const html = renderPage(emptyModel({
    prd: { productName: '<script>' },
  }));
  assert.match(
    html,
    /<span class="name" title="&lt;script&gt;">&lt;script&gt;<\/span>/,
    'title must share the same escaping path as the inner text',
  );
  assert.doesNotMatch(html, /title="<script>"/);
});

test('AC-202-5: no title attribute when the product block collapses', () => {
  const html = renderPage(emptyModel());
  // Product block is empty when there is no project name; no <span class="name"> at all.
  assert.doesNotMatch(html, /<span class="name"/);
});
