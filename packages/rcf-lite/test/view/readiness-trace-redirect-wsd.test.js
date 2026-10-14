// Regression test for the viewer trace-link redirect bug reported by
// the operator on 2026-10-14 (w-2026-10-14-dave-006, SPEC-AND-TEST
// hand).
//
// Repro: in the viewer, Readiness tab, Coverage sub-tab, each row has
// a Trace link that writes `#tab=readiness&sub=trace&entity=<id>` and
// expects the Readiness/trace sub-view to render and stay there.
// Observed: the trace sub-view flashes for an instant, then the viewer
// redirects to the Requirements tab (with the entity in context).
//
// Mechanism (src/view/page-init.js: resolveHash, lines 666..730):
// on a `#tab=readiness&sub=trace&entity=REQ-...` hash, the fast path
// activates the Readiness tab AND calls applyReadinessHash to switch
// the sub-tab to `trace`. It then falls into the shared
// `if (params.entity)` block which calls findByDocId(entity). The
// matching element lives inside the Requirements tabpanel, so
// `tabForNode(ent)` returns 'requirements', the branch at line 720
// sees `entTabName !== tab` and calls `activateTab('requirements')`.
// The Readiness/trace sub-view that just mounted is replaced by the
// Requirements doc view.
//
// This test boots page-init.js in a VM sandbox (precedent:
// trace-matrix-client.test.js, theme-control.test.js), seeds the hash
// to the exact Trace-link shape, and asserts the Readiness tab stays
// active and the trace sub-panel stays visible. The current main
// branch fails on both assertions; a one-line gate in the entity
// branch of resolveHash (skip the entity-redirect when
// `params.tab === 'readiness' && params.sub === 'trace'`) turns it
// green.
//
// Node 24 built-ins only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const pageInitPath = resolve(here, '..', '..', 'src', 'view', 'page-init.js');

// A tiny element shim: just enough shape for page-init.js's lookups,
// attribute toggles, and ancestor walks. parentNode is tracked so
// tabForNode's walk-up reaches the owning tabpanel.
function makeEl(tagName, attrs) {
  const el = {
    tagName: String(tagName).toUpperCase(),
    _attrs: new Map(),
    children: [],
    parentNode: null,
    style: {},
    offsetWidth: 0,
    innerHTML: '',
    open: false,
    hidden: false,
    classList: {
      _set: new Set(),
      add(name) { this._set.add(name); },
      remove(name) { this._set.delete(name); },
      contains(name) { return this._set.has(name); },
    },
    _listeners: {},
    getAttribute(k) { return this._attrs.has(k) ? this._attrs.get(k) : null; },
    setAttribute(k, v) { this._attrs.set(k, String(v)); },
    removeAttribute(k) { this._attrs.delete(k); },
    hasAttribute(k) { return this._attrs.has(k); },
    appendChild(child) {
      this.children.push(child);
      child.parentNode = this;
      return child;
    },
    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx >= 0) this.children.splice(idx, 1);
      child.parentNode = null;
      return child;
    },
    addEventListener(evt, fn) { (this._listeners[evt] ||= []).push(fn); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    scrollIntoView() {},
  };
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) el._attrs.set(k, String(v));
  }
  return el;
}

function makeDom({ hash }) {
  // id → element lookup. getElementById is wired through this map.
  const byId = new Map();

  // Register an element in byId AND set its id attribute. The attribute
  // is where resolveHash reads the panel id from in tabForNode.
  function withId(el, id) {
    el._attrs.set('id', id);
    el.id = id;
    byId.set(id, el);
    return el;
  }

  const html = makeEl('html');
  const body = makeEl('body');

  // nav.tabs > tab buttons for every TAB in page-init.js. The ancestor
  // chain is a nav with className='tabs' so a `nav.tabs [role="tab"]`
  // selector resolves to just the six top-level tab buttons.
  const nav = makeEl('nav');
  nav._attrs.set('class', 'tabs');
  body.appendChild(nav);
  const tabNames = ['readiness', 'overview', 'requirements', 'architecture', 'build', 'product-map'];
  const tabButtons = tabNames.map((name) => {
    const btn = makeEl('button', { role: 'tab', 'data-tab': name, 'aria-selected': 'false' });
    nav.appendChild(btn);
    return btn;
  });

  // One tabpanel per tab name. page-init starts with every panel but
  // Readiness hidden.
  const panels = {};
  for (const name of tabNames) {
    const p = makeEl('section', { role: 'tabpanel' });
    withId(p, 'tab-' + name);
    if (name !== 'readiness') p._attrs.set('hidden', '');
    body.appendChild(p);
    panels[name] = p;
  }

  // Readiness sub-tab strip + sub-panels inside the Readiness tabpanel.
  const strip = makeEl('div', { 'data-rcf-subtabstrip': 'readiness' });
  const subNames = ['overview', 'questions', 'blocking', 'coverage', 'trace'];
  const subButtons = subNames.map((sub) => {
    const b = makeEl('button', { role: 'tab', 'data-sub': sub, 'aria-selected': sub === 'overview' ? 'true' : 'false' });
    strip.appendChild(b);
    return b;
  });
  // Give the strip a querySelectorAll that handles the one call page-init
  // makes against it: strip.querySelectorAll('[role="tab"]').
  strip.querySelectorAll = (sel) => (sel === '[role="tab"]' ? subButtons.slice() : []);
  panels.readiness.appendChild(strip);
  const subPanels = {};
  for (const sub of subNames) {
    const sp = makeEl('div', { 'data-rcf-subpanel': sub });
    if (sub !== 'overview') sp._attrs.set('hidden', '');
    panels.readiness.appendChild(sp);
    subPanels[sub] = sp;
  }
  // The trace sub-panel carries the trace root; wireTraceMatrix() picks
  // it up via [data-rcf-trace-root].
  const traceRoot = makeEl('div', { 'data-rcf-trace-root': '' });
  subPanels.trace.appendChild(traceRoot);

  // A document-id-tagged element for REQ-002 nested in the Requirements
  // tabpanel. This is what findByDocId picks up and what tabForNode
  // walks back from.
  const reqDoc = makeEl('details', { 'data-doc-id': 'REQ-002' });
  withId(reqDoc, 'REQ-002');
  panels.requirements.appendChild(reqDoc);

  // Keep a flat list of all elements for the selector matchers.
  const allEls = [];
  (function flatten(node) {
    allEls.push(node);
    for (const c of node.children) flatten(c);
  })(body);

  function matchesSimple(el, selector) {
    // Very small subset of CSS selectors needed by page-init.js:
    //  - '[data-x="val"]', '[data-x]'
    //  - 'nav.tabs [role="tab"]'
    //  - combined attribute selectors are not needed for this test.
    if (selector === 'nav.tabs [role="tab"]') {
      return el.getAttribute && el.getAttribute('role') === 'tab' && hasAncestorMatching(el, (n) => n.tagName === 'NAV' && (n.getAttribute('class') || '').split(/\s+/).includes('tabs'));
    }
    const bracket = /^\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\]$/.exec(selector);
    if (bracket) {
      const key = bracket[1];
      const want = bracket[2];
      if (!el.getAttribute) return false;
      const got = el.getAttribute(key);
      if (want === undefined) return got !== null;
      return got === want;
    }
    return false;
  }
  function hasAncestorMatching(el, pred) {
    let cur = el.parentNode;
    while (cur) {
      if (pred(cur)) return true;
      cur = cur.parentNode;
    }
    return false;
  }

  const document = {
    documentElement: html,
    body,
    readyState: 'complete',
    _listeners: {},
    addEventListener(evt, fn) { (this._listeners[evt] ||= []).push(fn); },
    getElementById(id) { return byId.has(id) ? byId.get(id) : null; },
    getElementsByTagName() { return []; },
    createElement(tag) { return makeEl(tag); },
    querySelector(sel) {
      for (const el of allEls) if (matchesSimple(el, sel)) return el;
      return null;
    },
    querySelectorAll(sel) {
      const out = [];
      for (const el of allEls) if (matchesSimple(el, sel)) out.push(el);
      return out;
    },
  };

  const win = {
    location: { pathname: '/', search: '', origin: 'http://localhost', hash },
    history: {
      replaceState(_s, _t, url) {
        // Only track the fragment the Router rewrites; page-init may
        // rewrite the hash to drop an unknown sub=. For our test that
        // never fires because sub=trace is known.
        if (typeof url === 'string') {
          const h = url.indexOf('#');
          if (h >= 0) win.location.hash = url.slice(h);
        }
      },
      pushState(_s, _t, url) { win.history.replaceState(_s, _t, url); },
    },
    localStorage: null,
    sessionStorage: null,
    document,
    rcfPage: null,
    rcfView: null,
    rcfTraceInternals: null,
    _listeners: {},
    addEventListener(evt, fn) { (this._listeners[evt] ||= []).push(fn); },
    XMLHttpRequest: function () {
      this.readyState = 0;
      this.status = 0;
      this.open = () => { this.readyState = 1; };
      // No send: the trace fetch never completes; the shell render it
      // issued before the fetch is what we observe (sub-panel visible).
      this.send = () => {};
    },
  };

  return { win, document, panels, subPanels, tabButtons, subButtons, reqDoc, traceRoot };
}

async function bootPageInit({ hash }) {
  const code = await readFile(pageInitPath, 'utf8');
  const dom = makeDom({ hash });
  const context = vm.createContext({
    window: dom.win,
    document: dom.document,
    location: dom.win.location,
    setTimeout: (fn) => fn(),
    clearTimeout: () => {},
    XMLHttpRequest: dom.win.XMLHttpRequest,
    URL,
    URLSearchParams,
  });
  vm.runInContext(code, context, { filename: 'page-init.js' });
  return dom;
}

// -----------------------------------------------------------------
// Trace-link redirect bug: following a Trace link on a Coverage row
// must land on the Readiness/trace sub-view and stay there. On main
// resolveHash activates the Readiness tab, then overrides it with
// activateTab('requirements') because the entity (REQ-002) resolves
// to a doc that lives on the Requirements tab.
// -----------------------------------------------------------------
test('viewer: a trace-link hash (#tab=readiness&sub=trace&entity=REQ-002) lands on and stays on the Readiness/trace sub-view', async () => {
  const dom = await bootPageInit({ hash: '#tab=readiness&sub=trace&entity=REQ-002' });

  // The Readiness tabpanel is the only top-level panel without hidden.
  assert.equal(dom.panels.readiness.getAttribute('hidden'), null, 'Readiness tab stays active after resolveHash');
  assert.equal(dom.panels.requirements.getAttribute('hidden'), '', 'Requirements tab is NOT the active panel; the Trace link must not redirect to it');

  // The Trace sub-panel is the one visible Readiness sub-view.
  assert.equal(dom.subPanels.trace.getAttribute('hidden'), null, 'Readiness Trace sub-panel stays visible');
  assert.equal(dom.subPanels.overview.getAttribute('hidden'), '', 'Readiness Overview sub-panel is hidden under sub=trace');

  // The sub-tab strip's `trace` button is the one marked aria-selected.
  const activeSub = dom.subButtons.find((b) => b.getAttribute('aria-selected') === 'true');
  assert.ok(activeSub, 'a readiness sub-tab is aria-selected');
  assert.equal(activeSub.getAttribute('data-sub'), 'trace');

  // The top-level tab strip's `readiness` button is the one marked
  // aria-selected (bare proof the readiness tab is the one the user is
  // reading).
  const activeTopTab = dom.tabButtons.find((b) => b.getAttribute('aria-selected') === 'true');
  assert.ok(activeTopTab, 'a top-level tab is aria-selected');
  assert.equal(activeTopTab.getAttribute('data-tab'), 'readiness');
});
