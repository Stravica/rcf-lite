// Tests for the browser-side live-client. Because the target JavaScript
// is a classic script (no ESM syntax on the browser side; see D13a
// script tag in the base HTML), it cannot be imported directly here.
// Instead, we read the file source and execute it inside a `node:vm`
// sandbox with minimal window/document/localStorage stand-ins - no jsdom
// dep. The script installs itself as `globalThis.__rcfLiveClient` in a
// non-browser sandbox (no `window` + `document`); the tests drive the
// pure helpers (`snapshotState`, `restoreState`, `classifyConnection`,
// `shouldApplyUpdate`).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const clientPath = resolve(repoRoot, 'src', 'view', 'live-client.js');
const clientSource = await readFile(clientPath, 'utf8');

/** Execute the live-client in a fresh sandbox with no window/document,
 * and return the `__rcfLiveClient` API surface. */
function loadClient() {
  const sandbox = {};
  sandbox.globalThis = sandbox;
  runInNewContext(clientSource, sandbox);
  return sandbox.__rcfLiveClient;
}

function makeStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    _all: () => Object.fromEntries(m),
  };
}

function makeDoc(details = [], scrollHost = null) {
  // details: array of { id: string, open: boolean }
  const nodes = details.map((d) => ({
    open: d.open,
    _id: d.id,
    getAttribute(name) { return name === 'data-doc-id' ? d.id : null; },
  }));
  const main = scrollHost ? { scrollTop: scrollHost } : { scrollTop: 0 };
  return {
    querySelectorAll(sel) {
      if (sel === 'details[data-doc-id]') return nodes;
      return [];
    },
    querySelector(sel) {
      if (sel === 'main') return main;
      const m = sel.match(/^details\[data-doc-id="(.+)"\]$/);
      if (m) return nodes.find((n) => n._id === m[1]) ?? null;
      return null;
    },
    _main: main,
    _nodes: nodes,
  };
}

test('live-client snapshotState writes open <details> ids to localStorage', () => {
  const lc = loadClient();
  const storage = makeStorage();
  const doc = makeDoc([
    { id: 'REQ-001', open: true },
    { id: 'REQ-002', open: false },
    { id: 'US-101', open: true },
  ]);
  lc.snapshotState({ document: doc, storage });
  const raw = storage.getItem(lc.STORAGE_OPEN);
  const set = JSON.parse(raw);
  assert.deepEqual(set.sort(), ['REQ-001', 'US-101'].sort());
});

test('live-client snapshotState writes scrollTop to localStorage', () => {
  const lc = loadClient();
  const storage = makeStorage();
  const doc = makeDoc([], 250);
  lc.snapshotState({ document: doc, storage });
  assert.equal(storage.getItem(lc.STORAGE_SCROLL), '250');
});

test('live-client restoreState reopens persisted <details> ids after a swap', () => {
  const lc = loadClient();
  const storage = makeStorage({
    'rcf-view:v1:openDetails': JSON.stringify(['REQ-001', 'US-101']),
  });
  const doc = makeDoc([
    { id: 'REQ-001', open: false },
    { id: 'REQ-002', open: false },
    { id: 'US-101', open: false },
  ]);
  const summary = lc.restoreState({ document: doc, storage });
  assert.equal(summary.openedCount, 2);
  assert.equal(summary.droppedIds.length, 0);
  const req1 = doc._nodes.find((n) => n._id === 'REQ-001');
  const us101 = doc._nodes.find((n) => n._id === 'US-101');
  assert.equal(req1.open, true);
  assert.equal(us101.open, true);
});

test('live-client restoreState sets main scrollTop to the persisted value', () => {
  const lc = loadClient();
  const storage = makeStorage({ 'rcf-view:v1:scrollTop': '512' });
  const doc = makeDoc([], 0);
  lc.restoreState({ document: doc, storage });
  assert.equal(doc._main.scrollTop, 512);
});

test('live-client restoreState silently drops stale ids not present in the DOM (stale-key hygiene)', () => {
  const lc = loadClient();
  const storage = makeStorage({
    'rcf-view:v1:openDetails': JSON.stringify(['REQ-001', 'DELETED-1', 'DELETED-2']),
  });
  const doc = makeDoc([{ id: 'REQ-001', open: false }]);
  const summary = lc.restoreState({ document: doc, storage });
  assert.equal(summary.openedCount, 1);
  assert.deepStrictEqual(
    Array.from(summary.droppedIds).sort(),
    ['DELETED-1', 'DELETED-2'].sort(),
  );
  // The persisted set should be rewritten with only the surviving id.
  assert.deepStrictEqual(
    JSON.parse(storage.getItem('rcf-view:v1:openDetails')),
    ['REQ-001'],
  );
});

test('live-client snapshotState is soft on setItem throwing (quota / private mode)', () => {
  const lc = loadClient();
  const storage = {
    getItem: () => null,
    setItem: () => { throw new Error('QuotaExceededError'); },
    removeItem: () => {},
  };
  const doc = makeDoc([{ id: 'REQ-001', open: true }], 100);
  assert.doesNotThrow(() => lc.snapshotState({ document: doc, storage }));
});

test('live-client restoreState is soft on getItem throwing', () => {
  const lc = loadClient();
  const storage = {
    getItem: () => { throw new Error('SecurityError'); },
    setItem: () => {},
    removeItem: () => {},
  };
  const doc = makeDoc([{ id: 'REQ-001', open: false }]);
  assert.doesNotThrow(() => lc.restoreState({ document: doc, storage }));
});

test('live-client classifyConnection maps EventSource readyState to state names', () => {
  const lc = loadClient();
  assert.equal(lc.classifyConnection({ readyState: 1, msSinceLastEvent: 0 }), 'connected');
  assert.equal(lc.classifyConnection({ readyState: 0, msSinceLastEvent: 0 }), 'reconnecting');
  assert.equal(lc.classifyConnection({ readyState: 2, msSinceLastEvent: 0 }), 'disconnected');
});

test('live-client classifyConnection reports reconnecting when the heartbeat has staled', () => {
  const lc = loadClient();
  const stale = lc.HEARTBEAT_STALE_MS + 1000;
  assert.equal(lc.classifyConnection({ readyState: 1, msSinceLastEvent: stale }), 'reconnecting');
});

test('live-client shouldApplyUpdate skips replays and forces the first render', () => {
  const lc = loadClient();
  assert.equal(lc.shouldApplyUpdate(null, 1), true);
  assert.equal(lc.shouldApplyUpdate(1, 2), true);
  assert.equal(lc.shouldApplyUpdate(2, 1), false, 'older version must be ignored');
  assert.equal(lc.shouldApplyUpdate(2, 2), false, 'identical version must be ignored');
});

test('live-client memoryStorage acts as a working localStorage fallback', () => {
  const lc = loadClient();
  const s = lc.memoryStorage();
  assert.equal(s.getItem('missing'), null);
  s.setItem('k', 'v');
  assert.equal(s.getItem('k'), 'v');
  s.removeItem('k');
  assert.equal(s.getItem('k'), null);
});

test('live-client loadOpenSet returns an empty array when the key is missing', () => {
  const lc = loadClient();
  const storage = makeStorage();
  assert.deepStrictEqual(Array.from(lc.loadOpenSet(storage)), []);
});

test('live-client loadOpenSet ignores non-string entries defensively', () => {
  const lc = loadClient();
  const storage = makeStorage({
    'rcf-view:v1:openDetails': JSON.stringify(['REQ-001', 12, null, 'US-201']),
  });
  assert.deepStrictEqual(
    Array.from(lc.loadOpenSet(storage)).sort(),
    ['REQ-001', 'US-201'].sort(),
  );
});

// ---- resyncTabsAfterSwap (AC-18001-8, w-2026-10-06-dave-003) ---------
//
// After an SSE innerHTML swap of `#rcf-live-content`, the newly-inserted
// panels carry the Phase 3.6 server-rendered default (Readiness visible,
// others hidden). The tab bar sits outside the swap wrapper so its
// aria-selected button survives. resyncTabsAfterSwap must align every
// panel to the active button for every tab the server rendered -
// Readiness included (it is tab 1 since US-18001). Deriving the list
// from the DOM makes drift impossible: there is no second array to keep
// in sync with the renderer.

function makeTabDoc({ tabs, selected, visiblePanels }) {
  // tabs: array of data-tab names in nav.tabs order (as rendered).
  // selected: which data-tab the surviving header shows aria-selected.
  // visiblePanels: array of tab-<name> ids currently visible (not
  //   hidden) just after the SSE swap. The rest are hidden.
  const buttons = tabs.map((name) => {
    const attrs = { 'data-tab': name, role: 'tab' };
    if (name === selected) attrs['aria-selected'] = 'true';
    else attrs['aria-selected'] = 'false';
    return {
      _name: name,
      getAttribute(k) { return k in attrs ? attrs[k] : null; },
    };
  });
  const panels = {};
  for (const name of tabs) {
    const hidden = !visiblePanels.includes('tab-' + name);
    panels[name] = {
      _name: name,
      _hidden: hidden,
      hasAttribute(k) { return k === 'hidden' ? this._hidden : false; },
      setAttribute(k, _v) { if (k === 'hidden') this._hidden = true; },
      removeAttribute(k) { if (k === 'hidden') this._hidden = false; },
      querySelectorAll() { return []; },
    };
  }
  return {
    _buttons: buttons,
    _panels: panels,
    querySelector(sel) {
      if (sel === 'nav.tabs [role="tab"][aria-selected="true"]') {
        return buttons.find((b) => b.getAttribute('aria-selected') === 'true') || null;
      }
      return null;
    },
    querySelectorAll(sel) {
      if (sel === 'nav.tabs [role="tab"][data-tab]') return buttons;
      return [];
    },
    getElementById(id) {
      const m = id.match(/^tab-(.+)$/);
      if (!m) return null;
      return panels[m[1]] || null;
    },
  };
}

test('AC-18001-8 resyncTabsAfterSwap keeps Readiness visible when it is the active tab (issue 297)', () => {
  const lc = loadClient();
  // Six tabs as US-18001 ships: Readiness tab 1, Overview second, then
  // the Phase 3.8/3.9 four. Readiness is aria-selected. After the SSE
  // innerHTML swap only tab-readiness is visible from the server render
  // (the fresh content inherits the hidden-default scheme).
  const doc = makeTabDoc({
    tabs: ['readiness', 'overview', 'requirements', 'architecture', 'build', 'product-map'],
    selected: 'readiness',
    visiblePanels: ['tab-readiness'],
  });
  lc.resyncTabsAfterSwap(doc, {});
  // Only the Readiness panel is visible; no other panel is.
  const visible = Object.values(doc._panels).filter((p) => !p._hidden).map((p) => p._name);
  assert.deepStrictEqual(visible, ['readiness'],
    'exactly tab-readiness should be visible after the swap; got: ' + JSON.stringify(visible));
});

test('AC-18001-8 resyncTabsAfterSwap keeps Readiness visible on the embed-no-hash default (issue 297)', () => {
  const lc = loadClient();
  // Embed mount with no hash: rcfPage.init() routed to Readiness on
  // first paint. After an SSE swap the panels carry the Overview-first
  // server default (visiblePanels is tab-overview, not tab-readiness,
  // because the swap serves the Phase 3.6 default). The resync must
  // bring the panels back in line with the aria-selected button.
  const doc = makeTabDoc({
    tabs: ['readiness', 'overview', 'requirements', 'architecture', 'build', 'product-map'],
    selected: 'readiness',
    visiblePanels: ['tab-overview'],
  });
  lc.resyncTabsAfterSwap(doc, {});
  const visible = Object.values(doc._panels).filter((p) => !p._hidden).map((p) => p._name);
  assert.deepStrictEqual(visible, ['readiness'],
    'tab-readiness should be the only visible panel after the swap; got: ' + JSON.stringify(visible));
});

test('AC-18001-8 resyncTabsAfterSwap preserves Product Map through a swap (regression guard)', () => {
  const lc = loadClient();
  const doc = makeTabDoc({
    tabs: ['readiness', 'overview', 'requirements', 'architecture', 'build', 'product-map'],
    selected: 'product-map',
    visiblePanels: ['tab-readiness'],
  });
  lc.resyncTabsAfterSwap(doc, {});
  const visible = Object.values(doc._panels).filter((p) => !p._hidden).map((p) => p._name);
  assert.deepStrictEqual(visible, ['product-map']);
});

test('AC-18001-8 resyncTabsAfterSwap preserves every tab the DOM renders (SSOT invariant)', () => {
  // The invariant: the tab list is the server-rendered nav.tabs. For
  // every data-tab the DOM renders, if that tab is aria-selected the
  // resync keeps its #tab-<name> panel visible and hides the rest.
  // No parallel array in live-client.js can veto a tab the renderer
  // emitted.
  const lc = loadClient();
  const tabs = ['readiness', 'overview', 'requirements', 'architecture', 'build', 'product-map'];
  for (const tab of tabs) {
    const doc = makeTabDoc({
      tabs,
      selected: tab,
      visiblePanels: ['tab-overview'],
    });
    lc.resyncTabsAfterSwap(doc, {});
    const visible = Object.values(doc._panels).filter((p) => !p._hidden).map((p) => p._name);
    assert.deepStrictEqual(
      visible,
      [tab],
      'tab ' + tab + ' should be the sole visible panel after swap; got: ' + JSON.stringify(visible),
    );
  }
});

test('AC-18001-8 resyncTabsAfterSwap falls back to overview on no aria-selected button', () => {
  const lc = loadClient();
  const doc = makeTabDoc({
    tabs: ['readiness', 'overview', 'requirements'],
    selected: '__none__',
    visiblePanels: ['tab-requirements'],
  });
  lc.resyncTabsAfterSwap(doc, {});
  const visible = Object.values(doc._panels).filter((p) => !p._hidden).map((p) => p._name);
  assert.deepStrictEqual(visible, ['overview']);
});
