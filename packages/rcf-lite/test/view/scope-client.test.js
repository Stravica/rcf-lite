// Browser-side scope tests. Drive the live-client's URL-scope helpers
// in a node:vm sandbox against a fake DOM, without jsdom. Mirrors the
// same technique as `test/view/live-client.test.js` so the scope
// surface is exercised on the same shape the browser executes.

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

function loadClient() {
  const sandbox = {};
  sandbox.globalThis = sandbox;
  runInNewContext(clientSource, sandbox);
  return sandbox.__rcfLiveClient;
}

/**
 * Minimal DOM stand-in. Every "element" is a plain object carrying:
 *   - tagName
 *   - id (optional)
 *   - dataset id via getAttribute('data-doc-id')
 *   - classList with .add / .remove / .contains
 *   - children (walked by querySelectorAll)
 *   - parentNode (walked by openAncestorDetailsChain)
 * The mock recognises the queries the scope helpers actually run:
 *   - '[data-doc-id]'                       (walk every doc)
 *   - '.rcf-in-scope, .rcf-customised, .rcf-scope-ancestor' (clear markers)
 *   - '#rcf-live-content', 'main'           (banner insertion)
 */
function makeElement({ tagName = 'div', id = null, docId = null, children = [] } = {}) {
  const classes = new Set();
  const attrs = new Map();
  if (docId) attrs.set('data-doc-id', docId);
  const el = {
    tagName,
    id,
    open: false,
    firstChild: null,
    childNodes: [],
    parentNode: null,
    innerHTML: '',
    classList: {
      add: (c) => { classes.add(c); },
      remove: (c) => { classes.delete(c); },
      contains: (c) => classes.has(c),
      _all: () => Array.from(classes),
    },
    getAttribute: (name) => (attrs.has(name) ? attrs.get(name) : null),
    setAttribute: (name, val) => { attrs.set(name, val); },
    removeAttribute: (name) => { attrs.delete(name); },
    scrollIntoView: () => {},
    insertBefore(node, refNode) {
      // Only used by renderScopeBanner (banner insertion at main).
      node.parentNode = this;
      const idx = refNode ? this.childNodes.indexOf(refNode) : -1;
      if (idx < 0) this.childNodes.unshift(node);
      else this.childNodes.splice(idx, 0, node);
      this.firstChild = this.childNodes[0];
      this._children = this.childNodes;
      return node;
    },
    appendChild(node) {
      node.parentNode = this;
      this.childNodes.push(node);
      this._children = this.childNodes;
      return node;
    },
    removeChild(node) {
      const idx = this.childNodes.indexOf(node);
      if (idx >= 0) this.childNodes.splice(idx, 1);
      this._children = this.childNodes;
      node.parentNode = null;
      return node;
    },
    _children: children,
  };
  for (const c of children) c.parentNode = el;
  if (children.length > 0) el.firstChild = children[0];
  el.childNodes = children;
  el._children = children;
  return el;
}

function walkAll(root) {
  const acc = [];
  (function walk(node) {
    if (!node) return;
    acc.push(node);
    const kids = node.childNodes && node.childNodes.length > 0 ? node.childNodes : (node._children ?? []);
    for (const c of kids) walk(c);
  })(root);
  return acc;
}

function makeDoc({ scoped = [] } = {}) {
  const created = [];
  const docFragments = new Map();
  const contentChildren = scoped.map((s) => makeElement({
    tagName: 'details',
    docId: s.id,
    id: s.elementId ?? s.id,
  }));
  const content = makeElement({ id: 'rcf-live-content', children: contentChildren });
  const main = makeElement({ tagName: 'main', children: [content] });
  const body = makeElement({ tagName: 'body', children: [main] });
  const all = walkAll(body);

  const doc = {
    body,
    querySelector(sel) {
      const now = walkAll(body);
      if (sel === 'main') return main;
      if (sel === '#rcf-live-content') return content;
      const idMatch = sel.match(/\[data-doc-id="(.+)"\]/);
      if (idMatch) return now.find((el) => el.getAttribute('data-doc-id') === idMatch[1]) ?? null;
      return null;
    },
    querySelectorAll(sel) {
      const now = walkAll(body);
      if (sel === '[data-doc-id]') return now.filter((el) => el.getAttribute('data-doc-id'));
      if (sel.includes('.rcf-in-scope')) return now.filter((el) => (
        el.classList.contains('rcf-in-scope')
        || el.classList.contains('rcf-customised')
        || el.classList.contains('rcf-scope-ancestor')
      ));
      return [];
    },
    getElementById(id) {
      const now = walkAll(body);
      return now.find((el) => el.id === id) ?? null;
    },
    createElement(tagName) {
      const el = makeElement({ tagName });
      created.push(el);
      return el;
    },
  };
  return { doc, body, main, content, contentChildren, created };
}

test('scope: parseUrlScope reads blueprint and node from a search string', () => {
  const lc = loadClient();
  // vm-sandbox returns literals with a foreign prototype, so we
  // JSON-round-trip before comparing to keep node:assert happy.
  const plain = (v) => JSON.parse(JSON.stringify(v));
  assert.deepEqual(
    plain(lc.parseUrlScope('?blueprint=application-spa&node=REQ-001')),
    { blueprint: 'application-spa', node: 'REQ-001' },
  );
  assert.deepEqual(plain(lc.parseUrlScope('')), { blueprint: null, node: null });
  assert.deepEqual(plain(lc.parseUrlScope('?node=REQ-001')), { blueprint: null, node: 'REQ-001' });
  // URL-encoded space: our decoder converts `+` and `%20` to spaces, then trims.
  assert.deepEqual(plain(lc.parseUrlScope('?blueprint=+')), { blueprint: null, node: null });
});

test('scope: markScopeIds tags in-scope + customised nodes and their ancestor chains', () => {
  const lc = loadClient();
  const { doc, contentChildren, content, main, body } = makeDoc({
    scoped: [
      { id: 'REQ-001' },
      { id: 'REQ-002' },
      { id: 'REQ-999' }, // not in scope
    ],
  });
  const r = lc.markScopeIds(doc, ['REQ-001', 'REQ-002'], ['REQ-001']);
  assert.equal(r.inScopeCount, 2);
  assert.equal(r.customisedCount, 1);
  assert.equal(contentChildren[0].classList.contains('rcf-in-scope'), true);
  assert.equal(contentChildren[0].classList.contains('rcf-customised'), true);
  assert.equal(contentChildren[1].classList.contains('rcf-in-scope'), true);
  assert.equal(contentChildren[1].classList.contains('rcf-customised'), false);
  assert.equal(contentChildren[2].classList.contains('rcf-in-scope'), false);
  // Ancestors of in-scope nodes are marked so CSS keeps them full-strength.
  assert.equal(content.classList.contains('rcf-scope-ancestor'), true);
  assert.equal(main.classList.contains('rcf-scope-ancestor'), true);
});

test('scope: markScopeIds tolerates the raw-json ::raw suffix', () => {
  const lc = loadClient();
  const { doc, contentChildren } = makeDoc({
    scoped: [
      { id: 'REQ-001::raw', elementId: 'raw-req' },
      { id: 'REQ-001', elementId: 'req' },
    ],
  });
  lc.markScopeIds(doc, ['REQ-001'], []);
  // Both the doc-details and its inner raw-json disclosure light up
  // when the same canonical id is in scope.
  assert.equal(contentChildren[0].classList.contains('rcf-in-scope'), true);
  assert.equal(contentChildren[1].classList.contains('rcf-in-scope'), true);
});

test('scope: renderScopeBanner is idempotent across two passes', () => {
  const lc = loadClient();
  const { doc } = makeDoc({ scoped: [] });
  const first = lc.renderScopeBanner(doc, {
    blueprint: 'application-spa', node: null,
    inScopeCount: 3, customisedCount: 1, warning: '',
  });
  const second = lc.renderScopeBanner(doc, {
    blueprint: 'application-spa', node: 'REQ-001',
    inScopeCount: 4, customisedCount: 0, warning: '',
  });
  // Same DOM node was reused (banner id insertion is a single-shot).
  assert.equal(first, second);
  assert.match(second.innerHTML, /focus: REQ-001/);
  assert.match(second.innerHTML, /4 contributions/);
});

test('scope: applyUrlScope surfaces a "not applied" warning on a 404', async () => {
  const lc = loadClient();
  const { doc, body } = makeDoc({ scoped: [{ id: 'REQ-001' }] });
  const win = {
    location: { search: '?blueprint=nope' },
    addEventListener: () => {},
  };
  const fetchImpl = () => Promise.resolve({
    ok: false,
    status: 404,
    json: () => Promise.resolve({ error: 'unknownBlueprint', slug: 'nope' }),
  });
  const r = await lc.applyUrlScope({ document: doc, window: win, fetch: fetchImpl });
  assert.equal(r.applied, true);
  assert.equal(body.classList.contains('rcf-scoped'), true);
  const banner = doc.getElementById('rcf-scope-banner');
  assert.ok(banner);
  assert.match(banner.innerHTML, /nope is not applied/);
});

test('scope: applyUrlScope with no URL params clears any prior scope state', async () => {
  const lc = loadClient();
  const { doc, body, contentChildren } = makeDoc({ scoped: [{ id: 'REQ-001' }] });
  // Prime the DOM as if a prior scope was already applied.
  body.classList.add('rcf-scoped');
  contentChildren[0].classList.add('rcf-in-scope');
  const win = {
    location: { search: '' },
    addEventListener: () => {},
  };
  const r = await lc.applyUrlScope({ document: doc, window: win, fetch: () => Promise.reject(new Error('unused')) });
  assert.equal(r.applied, false);
  assert.equal(body.classList.contains('rcf-scoped'), false);
  assert.equal(contentChildren[0].classList.contains('rcf-in-scope'), false);
});
