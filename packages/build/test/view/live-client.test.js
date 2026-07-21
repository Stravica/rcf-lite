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
