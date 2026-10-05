// Standalone three-state theme control tests (US-206 amendments, TS-229
// extensions for AC-206-7..10, ADR-4137; w-2026-10-04-dave-001).
//
// AC-206-7  renderPage renders the control in non-embed; a click
//           updates `data-theme` live and flips `aria-pressed`.
// AC-206-8  non-embed persistence under `rcf-view:v1:theme`; postMessage
//           still applies live but writes nothing.
// AC-206-9  under `embed=1` the control is absent from the DOM entirely
//           and the storage key is never touched.
// AC-206-10 explicit `?theme=` beats the stored value and leaves the
//           stored key as-is.
//
// We use a tiny DOM shim rather than jsdom: page-init.js is a classic
// (non-module) IIFE, so we execute the file inside a VM context with a
// minimal `document` + `window` + `localStorage` stand-in. The invariant
// shape of page-init.js is pinned by shell-header.test.js and layout-
// regression.test.js; here we exercise its behavioural effects.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { renderPage } from '../../src/view/html-page.js';
import { renderThemeControl } from '../../src/view/view-index.js';

const here = dirname(fileURLToPath(import.meta.url));
const pageInitPath = resolve(here, '..', '..', 'src', 'view', 'page-init.js');

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

// -----------------------------------------------------------------
// AC-206-7: renderPage includes the three-state theme control
// -----------------------------------------------------------------

test('AC-206-7: renderPage includes the three-state theme control in non-embed; applyThemeControl updates data-theme and aria-pressed on click', () => {
  const html = renderPage(emptyModel());
  // The control is marked by data-rcf-theme-control and sits in .tools.
  assert.match(html, /<div class="tools"[^>]*>[\s\S]*?data-rcf-theme-control/);
  assert.match(html, /data-rcf-theme="light"/);
  assert.match(html, /data-rcf-theme="dark"/);
  assert.match(html, /data-rcf-theme="auto"/);
  // Three aria-pressed buttons start as false; page-init boot sets the
  // right one to true from the resolved theme choice.
  const matches = html.match(/data-rcf-theme="(light|dark|auto)"[^>]*aria-pressed="false"/g) || [];
  assert.equal(matches.length, 3);
});

test('AC-206-7: the control carries role="group" and three keyboard-operable buttons', () => {
  const ctl = renderThemeControl();
  assert.match(ctl, /role="group"/);
  // Three <button type="button"> inside the group.
  const buttons = ctl.match(/<button\s+type="button"/g) || [];
  assert.equal(buttons.length, 3);
});

// -----------------------------------------------------------------
// AC-206-9: embed path strips the control from the HTML string
// -----------------------------------------------------------------

test('AC-206-9: renderPage({ embed: true }) does not emit the theme control markup', () => {
  const html = renderPage(emptyModel(), { embed: true });
  assert.doesNotMatch(html, /data-rcf-theme-control/);
  assert.doesNotMatch(html, /data-rcf-theme="/);
});

// -----------------------------------------------------------------
// Boot the page-init IIFE in a VM sandbox and exercise the theme
// control wiring for AC-206-7, AC-206-8, AC-206-9, AC-206-10.
// -----------------------------------------------------------------

async function bootPageInit({ search = '', storedTheme = null } = {}) {
  const code = await readFile(pageInitPath, 'utf8');
  const dom = makeDom({ search, storedTheme });
  const context = vm.createContext({
    window: dom.window,
    document: dom.document,
    location: dom.window.location,
    setTimeout: (fn) => fn(),
    clearTimeout: () => {},
  });
  vm.runInContext(code, context, { filename: 'page-init.js' });
  dom.__context = context;
  return dom;
}

function makeDom({ search, storedTheme }) {
  const htmlAttrs = new Map();
  const listeners = { message: [] };
  const storage = {
    _map: new Map(),
    _reads: [],
    _writes: [],
    getItem(k) { this._reads.push(k); return this._map.has(k) ? this._map.get(k) : null; },
    setItem(k, v) { this._writes.push([k, String(v)]); this._map.set(k, String(v)); },
    removeItem(k) { this._writes.push([k, null]); this._map.delete(k); },
  };
  if (storedTheme != null) storage._map.set('rcf-view:v1:theme', storedTheme);
  // Reset the read/write counters AFTER the seeded value so the test's
  // assertion counts only the init+action phase.
  storage._reads = [];
  storage._writes = [];

  const controlEl = {
    tagName: 'DIV',
    _attrs: new Map([['class', 'rcf-theme'], ['data-rcf-theme-control', '']]),
    children: [],
    parentNode: null,
    getAttribute(k) { return this._attrs.has(k) ? this._attrs.get(k) : null; },
    setAttribute(k, v) { this._attrs.set(k, String(v)); },
    removeAttribute(k) { this._attrs.delete(k); },
  };
  const body = {
    _attrs: new Map(),
    getAttribute(k) { return this._attrs.has(k) ? this._attrs.get(k) : null; },
    setAttribute(k, v) { this._attrs.set(k, String(v)); },
    appendChild(c) { c.parentNode = this; },
    removeChild(c) { c.parentNode = null; return c; },
  };
  controlEl.parentNode = body;

  function makeButton(mode) {
    const b = {
      tagName: 'BUTTON',
      _attrs: new Map([['data-rcf-theme', mode], ['aria-pressed', 'false']]),
      _listeners: {},
      currentTarget: null,
      getAttribute(k) { return this._attrs.has(k) ? this._attrs.get(k) : null; },
      setAttribute(k, v) { this._attrs.set(k, String(v)); },
      removeAttribute(k) { this._attrs.delete(k); },
      addEventListener(evt, fn) { (this._listeners[evt] ||= []).push(fn); },
      click() {
        const list = this._listeners['click'] || [];
        for (const fn of list) fn({ currentTarget: this });
      },
    };
    controlEl.children.push(b);
    return b;
  }
  const buttons = {
    light: makeButton('light'),
    dark: makeButton('dark'),
    auto: makeButton('auto'),
  };

  const html = {
    _attrs: new Map(),
    getAttribute(k) { return this._attrs.has(k) ? this._attrs.get(k) : null; },
    setAttribute(k, v) { this._attrs.set(k, String(v)); },
    removeAttribute(k) { this._attrs.delete(k); },
  };

  const document = {
    documentElement: html,
    readyState: 'complete',
    body,
    addEventListener() {},
    getElementById() { return null; },
    getElementsByTagName() { return []; },
    createElement() {
      return {
        _attrs: new Map(),
        children: [],
        style: {},
        setAttribute(k, v) { this._attrs.set(k, String(v)); },
        getAttribute(k) { return this._attrs.has(k) ? this._attrs.get(k) : null; },
        removeAttribute(k) { this._attrs.delete(k); },
        appendChild(c) { this.children.push(c); return c; },
        addEventListener() {},
      };
    },
    querySelector(sel) {
      if (sel === '[data-rcf-theme-control]') return controlEl.parentNode ? controlEl : null;
      // Minimal matcher for the other selectors page-init.js looks up
      // during boot; we return null for anything we don't need.
      return null;
    },
    querySelectorAll(sel) {
      if (sel === '[data-rcf-theme-control] [data-rcf-theme]') {
        if (!controlEl.parentNode) return [];
        return controlEl.children.slice();
      }
      return [];
    },
  };

  const window = {
    location: {
      pathname: '/',
      search,
      origin: 'http://localhost',
      hash: '',
    },
    addEventListener(evt, fn) { (listeners[evt] ||= []).push(fn); },
    history: { replaceState() {} },
    localStorage: storage,
    sessionStorage: storage,
    document,
    rcfPage: null,
    rcfView: null,
    postMessage(payload, origin) {
      // simulate a same-origin postMessage round-trip
      const ev = { data: payload, origin };
      for (const fn of listeners.message || []) fn(ev);
    },
  };
  return { window, document, html, body, storage, buttons, controlEl, listeners };
}

// AC-206-7 behavioural: click on a button sets data-theme live and
// flips aria-pressed across the three.

test('AC-206-7 behaviour: a click on Dark sets data-theme="dark" and flips aria-pressed to Dark', async () => {
  const dom = await bootPageInit({ search: '' });
  dom.buttons.dark.click();
  assert.equal(dom.html.getAttribute('data-theme'), 'dark');
  assert.equal(dom.buttons.dark.getAttribute('aria-pressed'), 'true');
  assert.equal(dom.buttons.light.getAttribute('aria-pressed'), 'false');
  assert.equal(dom.buttons.auto.getAttribute('aria-pressed'), 'false');
});

test('AC-206-7 behaviour: a click on Auto removes data-theme so the media query decides', async () => {
  const dom = await bootPageInit({ search: '' });
  dom.buttons.dark.click();
  dom.buttons.auto.click();
  assert.equal(dom.html.getAttribute('data-theme'), null);
  assert.equal(dom.buttons.auto.getAttribute('aria-pressed'), 'true');
});

// AC-206-8: non-embed persistence under `rcf-view:v1:theme`; postMessage
// still applies live but does not write the key.

test('AC-206-8: non-embed persistence under rcf-view:v1:theme; postMessage path writes nothing', async () => {
  const dom = await bootPageInit({ search: '' });
  dom.buttons.light.click();
  const lightWrite = dom.storage._writes.find(([k, v]) => k === 'rcf-view:v1:theme' && v === 'light');
  assert.ok(lightWrite, 'click Light should write "light" to rcf-view:v1:theme');
  // Simulate a fresh boot with the stored value.
  const dom2 = await bootPageInit({ search: '', storedTheme: 'dark' });
  assert.equal(dom2.html.getAttribute('data-theme'), 'dark');
  assert.equal(dom2.buttons.dark.getAttribute('aria-pressed'), 'true');
});

test('AC-206-8: a rcf-view-theme postMessage applies live but does not write rcf-view:v1:theme', async () => {
  const dom = await bootPageInit({ search: '' });
  dom.window.postMessage({ type: 'rcf-view-theme', theme: 'dark' }, 'http://localhost');
  assert.equal(dom.html.getAttribute('data-theme'), 'dark');
  const anyWrite = dom.storage._writes.find(([k]) => k === 'rcf-view:v1:theme');
  assert.equal(anyWrite, undefined, 'postMessage must not write the stored theme key');
});

// AC-206-9: under embed, the control is removed from the DOM and the
// key is never read or written.

test('AC-206-9: embed=1 omits the control markup and does not touch rcf-view:v1:theme', async () => {
  const dom = await bootPageInit({ search: '?embed=1', storedTheme: 'dark' });
  // Control removed from DOM.
  assert.equal(dom.controlEl.parentNode, null);
  // Zero reads of the stored key (not even to resolve boot).
  const reads = dom.storage._reads.filter((k) => k === 'rcf-view:v1:theme');
  assert.equal(reads.length, 0, 'embed boot must not read rcf-view:v1:theme');
  // Zero writes.
  const writes = dom.storage._writes.filter(([k]) => k === 'rcf-view:v1:theme');
  assert.equal(writes.length, 0, 'embed boot must not write rcf-view:v1:theme');
  // A subsequent postMessage still applies live but writes nothing.
  dom.window.postMessage({ type: 'rcf-view-theme', theme: 'dark' }, 'http://localhost');
  const postMessageWrites = dom.storage._writes.filter(([k]) => k === 'rcf-view:v1:theme');
  assert.equal(postMessageWrites.length, 0, 'embed postMessage must not write rcf-view:v1:theme');
});

// AC-206-10: explicit ?theme= beats the stored value and leaves the
// stored key as-is.

test('AC-206-10: explicit ?theme= beats the stored value and leaves the key as-is', async () => {
  const dom = await bootPageInit({ search: '?theme=light', storedTheme: 'dark' });
  assert.equal(dom.html.getAttribute('data-theme'), 'light');
  assert.equal(dom.buttons.light.getAttribute('aria-pressed'), 'true');
  assert.equal(dom.buttons.dark.getAttribute('aria-pressed'), 'false');
  // Stored key is untouched (no write during boot).
  const bootWrites = dom.storage._writes.filter(([k]) => k === 'rcf-view:v1:theme');
  assert.equal(bootWrites.length, 0, 'boot must not write when ?theme= wins');
  // The stored value is still "dark" and a next boot without ?theme=
  // picks it up.
  const dom2 = await bootPageInit({ search: '', storedTheme: 'dark' });
  assert.equal(dom2.html.getAttribute('data-theme'), 'dark');
});

// -----------------------------------------------------------------
// PR 291 landing review F1 regressions. live-client re-invokes
// rcfPage.init() after every SSE innerHTML swap; the boot theme must
// be applied once, and a re-init must never override a host
// postMessage theme or a control choice.
// -----------------------------------------------------------------

test('PR 291 F1 regression: embed=1 host theme survives an rcfPage.init() re-run', async () => {
  const dom = await bootPageInit({ search: '?embed=1' });
  assert.equal(dom.html.getAttribute('data-theme'), null, 'embed boot with no ?theme= leaves auto');
  dom.window.postMessage({ type: 'rcf-view-theme', theme: 'dark' }, 'http://localhost');
  assert.equal(dom.html.getAttribute('data-theme'), 'dark');
  // The SSE swap path: live-client calls window.rcfPage.init().
  dom.window.rcfPage.init();
  assert.equal(dom.html.getAttribute('data-theme'), 'dark', 're-init must not wipe the host theme');
  dom.window.rcfPage.init();
  assert.equal(dom.html.getAttribute('data-theme'), 'dark', 'a second re-init must not wipe the host theme');
  const touched = [...dom.storage._reads, ...dom.storage._writes.map(([k]) => k)].filter((k) => k === 'rcf-view:v1:theme');
  assert.equal(touched.length, 0, 'embed must never touch rcf-view:v1:theme');
});

test('PR 291 F1 regression: standalone control choice survives an rcfPage.init() re-run with ?theme= in the URL', async () => {
  const dom = await bootPageInit({ search: '?theme=light' });
  assert.equal(dom.html.getAttribute('data-theme'), 'light');
  dom.buttons.dark.click();
  assert.equal(dom.html.getAttribute('data-theme'), 'dark');
  dom.window.rcfPage.init();
  assert.equal(dom.html.getAttribute('data-theme'), 'dark', 're-init must not revert a control choice to ?theme=');
  assert.equal(dom.buttons.dark.getAttribute('aria-pressed'), 'true');
  assert.equal(dom.buttons.light.getAttribute('aria-pressed'), 'false');
});

test('PR 291 F1: re-init with ?theme= and no later choice keeps the query theme; a host message then wins', async () => {
  const dom = await bootPageInit({ search: '?theme=light&embed=1' });
  dom.window.rcfPage.init();
  assert.equal(dom.html.getAttribute('data-theme'), 'light');
  dom.window.postMessage({ type: 'rcf-view-theme', theme: 'dark' }, 'http://localhost');
  dom.window.rcfPage.init();
  assert.equal(dom.html.getAttribute('data-theme'), 'dark', 're-init must not override a host message with ?theme=');
});
