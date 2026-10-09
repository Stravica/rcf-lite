// FBS-206 Readiness layout tests (US-18005 under REQ-180 / TAC-4135 /
// ADR-4139). Binds the eight ACs to real assertions against the
// rendered Readiness tab:
//
//   AC-18005-1 [happy]    stage grid: rows x (tree, delta) with
//                         pass/total/state and failing-count link
//   AC-18005-2 [happy]    SubTabStrip offers five keys; sub= writes
//                         to hash and router restores on load + SSE
//   AC-18005-3 [happy]    delta counts: six numbers; per-document
//                         list only when expanded
//   AC-18005-4 [happy]    engineer: no For-engineers DocRow and
//                         every engineer item still present
//   AC-18005-5 [happy]    freeze state: words naming failing gates
//                         / what resolves them; or words naming
//                         what a freeze would record
//   AC-18005-6 [edge]     acknowledged cell: state from stages[].state
//                         + reason from one helper, hover title
//   AC-18005-7 [must-not] embed + <720px: tables stack, strip stays
//   AC-18005-8 [failure]  unknown sub= drops to overview and is
//                         removed from the hash
//
// Node 24 built-ins only. No npm runtime deps. Where a test needs the
// browser-side router (sub= restore on SSE swap, unknown sub= drop),
// it reads the shipped page-init.js source and asserts the exact
// code path exists; combined with the pure helpers' tests here, that
// binds the AC without pulling jsdom. No test-skip, no todo flags.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { renderReadinessPanel, READINESS_SUBS } from '../../src/view/readiness.js';
import { buildCell, reasonForCell, renderVerdictGrid } from '../../src/view/readiness/grid.js';
import { foldCounts, renderDeltaCounts } from '../../src/view/readiness/delta-counts.js';

const PAGE_INIT_PATH = fileURLToPath(new URL('../../src/view/page-init.js', import.meta.url));
const PAGE_INIT_SRC = readFileSync(PAGE_INIT_PATH, 'utf8');
const STYLE_PATH = fileURLToPath(new URL('../../src/view/style.css', import.meta.url));
const STYLE_SRC = readFileSync(STYLE_PATH, 'utf8');

// ---- Minimal DOM shim for the Readiness SubTabStrip router -------------
//
// page-init.js is a classic IIFE; the theme-control test establishes
// precedent for executing it inside a VM sandbox with a hand-rolled
// DOM shim rather than pulling jsdom (zero runtime deps). We expose
// only the APIs the readiness router touches: a strip with five
// role="tab" buttons (data-sub=overview..trace), five panels with
// data-rcf-subpanel, document.querySelector / querySelectorAll with
// a minimal CSS-attribute parser, window.location.hash with change
// notifications, window.history.replaceState, and setTimeout as a
// pass-through. The shim is deliberately narrow: anything page-init
// touches outside the readiness block is a no-op.

function makeReadinessDom({ hash = '', withStrip = true } = {}) {
  const makeAttrEl = (tag) => {
    const el = {
      tagName: tag.toUpperCase(),
      _attrs: new Map(),
      _listeners: {},
      _children: [],
      parentNode: null,
      classList: {
        _set: new Set(),
        add(c) { this._set.add(c); },
        remove(c) { this._set.delete(c); },
        contains(c) { return this._set.has(c); },
      },
      style: {},
      getAttribute(k) { return this._attrs.has(k) ? this._attrs.get(k) : null; },
      setAttribute(k, v) { this._attrs.set(k, String(v)); },
      removeAttribute(k) { this._attrs.delete(k); },
      hasAttribute(k) { return this._attrs.has(k); },
      addEventListener(evt, fn) { (this._listeners[evt] ||= []).push(fn); },
      removeEventListener(evt, fn) { const list = this._listeners[evt] || []; const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); },
      appendChild(c) { c.parentNode = this; this._children.push(c); return c; },
      removeChild(c) { c.parentNode = null; const i = this._children.indexOf(c); if (i >= 0) this._children.splice(i, 1); return c; },
      click() { for (const fn of (this._listeners.click || [])) fn({ currentTarget: this, preventDefault() {} }); },
      innerHTML: '',
      textContent: '',
      querySelector(sel) { return domQuerySelector(this, sel); },
      querySelectorAll(sel) { return domQuerySelectorAll(this, sel); },
    };
    return el;
  };

  // Build the strip + five panels + the blocking filterbar skeleton
  // (so applyReadinessHash's blocking branch can traverse without
  // throwing). A pure overview-only render leaves the filterbar out.
  const body = makeAttrEl('body');
  const panels = {};
  const strip = withStrip ? makeAttrEl('div') : null;
  if (strip) {
    strip.setAttribute('data-rcf-subtabstrip', 'readiness');
    for (const key of ['overview', 'questions', 'blocking', 'coverage', 'trace']) {
      const btn = makeAttrEl('button');
      btn.setAttribute('role', 'tab');
      btn.setAttribute('data-sub', key);
      btn.setAttribute('aria-selected', key === 'overview' ? 'true' : 'false');
      strip.appendChild(btn);
    }
    body.appendChild(strip);
  }
  for (const key of ['overview', 'questions', 'blocking', 'coverage', 'trace']) {
    const p = makeAttrEl('div');
    p.setAttribute('data-rcf-subpanel', key);
    if (key !== 'overview') p.setAttribute('hidden', '');
    body.appendChild(p);
    panels[key] = p;
  }

  const htmlRoot = makeAttrEl('html');
  htmlRoot.appendChild(body);

  function domQuerySelector(root, sel) {
    const all = domQuerySelectorAll(root, sel);
    return all.length > 0 ? all[0] : null;
  }
  function domQuerySelectorAll(root, sel) {
    const out = [];
    const match = parseSel(sel);
    walk(root, (el) => { if (match(el)) out.push(el); });
    return out;
  }
  function parseSel(sel) {
    // Handles: tag, [attr], [attr="val"], [attr='val'], attr-only unquoted
    // and compound "[a="b"][c="d"]" plus role="tab"[aria-selected="true"].
    const atomRe = /\[([a-zA-Z_:][-a-zA-Z0-9_:]*)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/g;
    const atoms = [];
    let m; let last = 0; let tag = null;
    while ((m = atomRe.exec(sel)) !== null) {
      if (last === 0 && m.index > 0) tag = sel.slice(0, m.index).trim() || null;
      last = atomRe.lastIndex;
      atoms.push({ key: m[1], val: m[2] ?? m[3] ?? m[4] ?? null });
    }
    if (atoms.length === 0) tag = sel.trim() || null;
    return (el) => {
      if (tag && el.tagName && el.tagName.toLowerCase() !== tag.toLowerCase()) return false;
      for (const a of atoms) {
        if (!el._attrs || !el._attrs.has(a.key)) return false;
        if (a.val !== null && el._attrs.get(a.key) !== a.val) return false;
      }
      return true;
    };
  }
  function walk(root, fn) {
    for (const c of (root._children || [])) {
      fn(c);
      walk(c, fn);
    }
  }

  const hashListeners = [];
  const location = {
    _hash: hash,
    _pathname: '/',
    _search: '',
    get hash() { return this._hash; },
    set hash(v) {
      const next = v.startsWith('#') ? v : '#' + v;
      if (this._hash === next) return;
      this._hash = next;
      for (const fn of hashListeners) fn({ type: 'hashchange' });
    },
    get pathname() { return this._pathname; },
    get search() { return this._search; },
  };
  const history = {
    _entries: [],
    replaceState(state, title, url) {
      this._entries.push(['replace', url]);
      const h = (typeof url === 'string' && url.indexOf('#') >= 0) ? url.slice(url.indexOf('#')) : '';
      location._hash = h;
    },
    pushState(state, title, url) {
      this._entries.push(['push', url]);
      const h = (typeof url === 'string' && url.indexOf('#') >= 0) ? url.slice(url.indexOf('#')) : '';
      location._hash = h;
    },
  };
  const windowObj = {
    location,
    history,
    _listeners: {},
    addEventListener(evt, fn) { if (evt === 'hashchange') hashListeners.push(fn); (this._listeners[evt] ||= []).push(fn); },
    removeEventListener(evt, fn) { const list = this._listeners[evt] || []; const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); },
  };
  const documentObj = {
    documentElement: htmlRoot,
    body,
    readyState: 'complete',
    querySelector(sel) { return domQuerySelector(htmlRoot, sel); },
    querySelectorAll(sel) { return domQuerySelectorAll(htmlRoot, sel); },
    getElementById() { return null; },
    addEventListener() {},
    removeEventListener() {},
    createElement(tag) { return makeAttrEl(tag); },
  };
  return { window: windowObj, document: documentObj, location, history, body, strip, panels };
}

function bootPageInit({ hash = '' } = {}) {
  const dom = makeReadinessDom({ hash });
  const context = vm.createContext({
    window: dom.window,
    document: dom.document,
    location: dom.location,
    history: dom.history,
    setTimeout: (fn) => { try { fn(); } catch (e) {} return 0; },
    clearTimeout: () => {},
    console: { log() {}, warn() {}, error() {} },
    URL: globalThis.URL,
    URLSearchParams: globalThis.URLSearchParams,
  });
  vm.runInContext(PAGE_INIT_SRC, context, { filename: 'page-init.js' });
  dom.__context = context;
  return dom;
}

// Pull the readiness router helpers out of the sandbox so a test can
// exercise them directly without racing boot wiring. The IIFE exposes
// nothing on globals; we re-run the file after shimming a tiny probe
// at the end that captures the handful of functions we need. The
// shimmed source stays string-identical to the shipped file except
// for the appended probe.
function bootPageInitWithProbe(opts = {}) {
  const dom = makeReadinessDom(opts);
  const probe = `
    try {
      window.__rcfProbe = {
        applyReadinessHash: typeof applyReadinessHash === 'function' ? applyReadinessHash : null,
        readinessHashFragment: typeof readinessHashFragment === 'function' ? readinessHashFragment : null,
        activateReadinessSub: typeof activateReadinessSub === 'function' ? activateReadinessSub : null,
        wireReadinessSubTabStrip: typeof wireReadinessSubTabStrip === 'function' ? wireReadinessSubTabStrip : null,
      };
    } catch (e) { window.__rcfProbe = { error: String(e) }; }
  `;
  const WRAP = PAGE_INIT_SRC.replace(/\}\)\(\);\s*$/, probe + '\n})();');
  const context = vm.createContext({
    window: dom.window,
    document: dom.document,
    location: dom.location,
    history: dom.history,
    setTimeout: (fn) => { try { fn(); } catch (e) {} return 0; },
    clearTimeout: () => {},
    console: { log() {}, warn() {}, error() {} },
    URL: globalThis.URL,
    URLSearchParams: globalThis.URLSearchParams,
  });
  vm.runInContext(WRAP, context, { filename: 'page-init.js' });
  dom.__context = context;
  dom.__probe = dom.window.__rcfProbe || null;
  return dom;
}

// ---- fixtures -----------------------------------------------------------

function stage({ id, gate, state = 'failing', treeFailing = 1, deltaFailing = 0, deltaTotal = 1, persona = 'engineer', reason }) {
  const checks = [];
  if (treeFailing > 0) {
    checks.push({
      name: `${id.toLowerCase()}:tree`,
      ok: false,
      over: 'tree',
      pass: 0,
      total: treeFailing,
      failing: Array.from({ length: treeFailing }, (_, i) => ({ id: `${id}:item${i + 1}`, why: 'why tree' })),
      persona,
      question: 'tree q',
    });
  } else {
    checks.push({
      name: `${id.toLowerCase()}:tree`,
      ok: true, over: 'tree', pass: 1, total: 1, failing: [], persona, question: 'tree q',
    });
  }
  checks.push({
    name: `${id.toLowerCase()}:delta`,
    ok: deltaFailing === 0,
    over: 'delta',
    pass: deltaFailing === 0 ? deltaTotal : Math.max(0, deltaTotal - deltaFailing),
    total: deltaTotal,
    failing: Array.from({ length: deltaFailing }, (_, i) => ({ id: `${id}:delta${i + 1}`, why: 'why delta' })),
    persona,
    question: 'delta q',
  });
  const s = { stage: id, gate, state, checks };
  if (reason) s.reason = reason;
  return s;
}

function readinessFixture({ freezeable = false, decisions = [] } = {}) {
  const stages = [
    stage({ id: 'D1', gate: 'define.brief', persona: 'productOwner', treeFailing: 1 }),
    stage({ id: 'D4', gate: 'define.stories', persona: 'productOwner', treeFailing: 0, deltaFailing: 1 }),
    stage({ id: 'D5', gate: 'define.crosscut', persona: 'engineer', treeFailing: 2 }),
    stage({ id: 'D6', gate: 'define.probe', state: 'acknowledged', persona: 'engineer', treeFailing: 1, deltaFailing: 0 }),
    stage({ id: 'D8', gate: 'define.freeze', state: 'notApplicable', persona: 'engineer', treeFailing: 0, deltaFailing: 0, deltaTotal: 0, reason: 'tree already freezable' }),
  ];
  // D8 has no delta checks; drop the auto-generated delta check so
  // its delta column is notApplicable.
  stages[4].checks = [
    { name: 'd8:tree', ok: true, over: 'tree', pass: 1, total: 1, failing: [], persona: 'engineer', question: 'q' },
  ];
  const blockedBy = [
    { stage: 'D1', gate: 'define.brief', check: 'd1:tree', persona: 'productOwner', over: 'tree', failingCount: 1, ids: ['D1:item1'], question: 'q' },
    { stage: 'D5', gate: 'define.crosscut', check: 'd5:tree', persona: 'engineer', over: 'tree', failingCount: 2, ids: ['D5:item1', 'D5:item2'], question: 'q' },
  ];
  const result = {
    tree: { treeHash: 'abc', currentTreeHash: 'def', frozenTreeHash: 'abc' },
    stages,
    delta: {
      changed: ['REQ-010'],
      added: ['REQ-011'],
      removed: [],
      briefSince: [1, 2, 3],
      impacted: ['AC-18005-1'],
      impactedFbs: ['FBS-206'],
      currentDocHashes: { 'REQ-010': 'hash10', 'REQ-011': 'hash11' },
    },
    levels: {
      intentComplete: { ok: freezeable, blockedBy: freezeable ? [] : blockedBy.filter((b) => b.persona === 'productOwner'), nextAction: null },
      readyToBuild: { ok: freezeable, blockedBy: freezeable ? [] : blockedBy, nextAction: null },
    },
    personas: {
      productOwner: { blockers: [], nextAction: null },
      engineer: { blockers: [], nextAction: null },
    },
    coverage: {
      tree: {
        totals: { requirements: 2, covered: 1, coveredUnresolved: 0, uncovered: 1 },
        requirements: [{ id: 'REQ-010', coverageClass: 'covered' }, { id: 'REQ-011', coverageClass: 'uncovered' }],
        unresolvedTestPointers: [],
      },
    },
    questions: [],
    decisions,
  };
  return result;
}

// ---- AC-18005-1 ---------------------------------------------------------

test('AC-18005-1 happy: stage grid renders rows x (tree, delta) with pass/total/state and failing-count link', () => {
  const result = readinessFixture();
  const html = renderVerdictGrid({ stages: result.stages, freezeRecord: null });
  assert.match(html, /data-rcf-table="verdict-grid"/);
  assert.match(html, /data-scope="tree"/);
  assert.match(html, /data-scope="delta"/);
  for (const s of result.stages) {
    assert.match(html, new RegExp(`data-rcf-stage="${s.stage}"`));
  }
  // D1 tree cell: 0/1, failing, link to blocking filtered to D1 (ampersand HTML-escaped).
  assert.match(html, /data-rcf-stage="D1"[\s\S]*?data-rcf-cell-state="failing"[\s\S]*?data-rcf-cell-scope="tree"[\s\S]*?data-rcf-cell-pass="0"[\s\S]*?data-rcf-cell-total="1"[\s\S]*?data-rcf-cell-failing="1"[\s\S]*?href="#tab=readiness&amp;sub=blocking&amp;stage=D1"/);
  // D4 delta cell is failing on its own (tree passed on D4).
  assert.match(html, /data-rcf-stage="D4"[\s\S]*?data-rcf-cell-state="failing"[\s\S]*?data-rcf-cell-scope="delta"/);
  // buildCell shape (direct unit assertion)
  const d1Tree = buildCell(result.stages[0], 'tree', null);
  assert.equal(d1Tree.pass, 0);
  assert.equal(d1Tree.total, 1);
  assert.equal(d1Tree.state, 'failing');
  assert.equal(d1Tree.failing, 1);
  assert.ok(d1Tree.href && d1Tree.href.includes('stage=D1'));
});

// ---- AC-18005-2 ---------------------------------------------------------

test('AC-18005-2 happy: the SubTabStrip offers five keys, activeSub is reflected, and the router restores sub= on load and after an SSE swap', () => {
  const html = renderReadinessPanel(readinessFixture(), { profile: null, activeSub: 'overview' });
  // Strip markup
  assert.match(html, /data-rcf-subtabstrip="readiness"/);
  // Five keys in authoring order
  assert.deepEqual(READINESS_SUBS, ['overview', 'questions', 'blocking', 'coverage', 'trace']);
  for (const key of READINESS_SUBS) {
    assert.match(html, new RegExp(`data-sub="${key}"`), `missing sub=${key}`);
    assert.match(html, new RegExp(`data-rcf-subpanel="${key}"`), `missing subpanel=${key}`);
  }
  // Overview active, the rest hidden on first paint with activeSub=overview
  assert.match(html, /data-sub="overview"[^>]*aria-selected="true"/);
  for (const key of ['questions', 'blocking', 'coverage', 'trace']) {
    assert.match(html, new RegExp(`data-rcf-subpanel="${key}"[^>]*hidden`), `${key} should be hidden on initial render`);
  }
  // activeSub flips the hidden attribute: a server-rendered sub=blocking
  // paints with blocking visible and overview hidden.
  const htmlBlocking = renderReadinessPanel(readinessFixture(), { profile: null, activeSub: 'blocking' });
  assert.match(htmlBlocking, /data-sub="blocking"[^>]*aria-selected="true"/);
  assert.match(htmlBlocking, /data-rcf-subpanel="overview"[^>]*hidden/);
  assert.doesNotMatch(htmlBlocking, /data-rcf-subpanel="blocking"[^>]*hidden/);

  // Router: page-init.js's resolveHash fast path calls applyReadinessHash
  // on #tab=readiness; applyReadinessHash activates the sub-tab from
  // params.sub. The SSE swap re-runs onReady, which re-wires the strip
  // and calls resolveHash(window.location.hash) - the hash is read back
  // from the URL and the sub re-activated.
  assert.ok(/if \(tab === 'readiness' && readinessSubTabStrip\(\)\) \{\s*applyReadinessHash\(params\);/.test(PAGE_INIT_SRC), 'router calls applyReadinessHash for the readiness tab');
  assert.ok(/function applyReadinessHash\(params\)/.test(PAGE_INIT_SRC), 'applyReadinessHash defined');
  assert.ok(/activateReadinessSub\(sub\);/.test(PAGE_INIT_SRC), 'applyReadinessHash activates the right sub');
  // onReady wires the strip and resolves the hash (SSE re-init path).
  assert.ok(/wireReadinessSubTabStrip\(\);\s*resolveHash\(window.location.hash\);/.test(PAGE_INIT_SRC), 'onReady wires the strip and resolves the hash on each init (SSE re-init path)');

  // Runtime binding: boot page-init in a vm sandbox with a minimal DOM
  // and exercise applyReadinessHash via the probe. The sub=blocking
  // case activates the blocking panel and leaves the others hidden.
  const dom = bootPageInitWithProbe({ hash: '#tab=readiness&sub=blocking' });
  assert.ok(dom.__probe, 'probe captured');
  assert.equal(typeof dom.__probe.applyReadinessHash, 'function', 'applyReadinessHash exposed');
  dom.__probe.applyReadinessHash({ tab: 'readiness', sub: 'blocking' });
  assert.ok(!dom.panels.blocking.hasAttribute('hidden'), 'blocking panel active after applyReadinessHash');
  assert.ok(dom.panels.overview.hasAttribute('hidden'), 'overview panel hidden after sub=blocking');
  // Re-apply with sub=questions and the active panel flips.
  dom.__probe.applyReadinessHash({ tab: 'readiness', sub: 'questions' });
  assert.ok(!dom.panels.questions.hasAttribute('hidden'), 'questions panel active after re-apply');
  assert.ok(dom.panels.blocking.hasAttribute('hidden'), 'blocking panel hidden after re-apply');
  // readinessHashFragment echoes the current sub when it is not overview.
  const frag = dom.__probe.readinessHashFragment();
  assert.ok(/tab=readiness.*sub=questions/.test(frag), 'readinessHashFragment carries the active sub when not overview');
});

// ---- AC-18005-3 ---------------------------------------------------------

test('AC-18005-3 happy: delta counts render six numbers; per-document list only after expand', () => {
  const result = readinessFixture();
  const html = renderDeltaCounts({ delta: result.delta, freezeRecord: null, expanded: false });
  // Each tile echoes the raw delta input, not just the renderer's own
  // fold of it. The fixture has one changed, one added, zero removed,
  // three briefSince, one impacted, one impactedFbs.
  const raw = {
    changed: result.delta.changed.length,
    added: result.delta.added.length,
    removed: result.delta.removed.length,
    briefSince: result.delta.briefSince.length,
    impacted: result.delta.impacted.length,
    impactedFbs: result.delta.impactedFbs.length,
  };
  assert.equal(raw.changed, 1);
  assert.equal(raw.added, 1);
  assert.equal(raw.removed, 0);
  assert.equal(raw.briefSince, 3);
  assert.equal(raw.impacted, 1);
  assert.equal(raw.impactedFbs, 1);
  for (const key of ['changed', 'added', 'removed', 'briefSince', 'impacted', 'impactedFbs']) {
    assert.match(html, new RegExp(`data-rcf-count="${key}"[^>]*data-rcf-count-value="${raw[key]}"`), `tile for ${key} echoes raw delta`);
  }
  // foldCounts stays consistent with the raw input (defensive dual check).
  const folded = foldCounts(result.delta);
  for (const key of Object.keys(raw)) {
    assert.equal(folded[key], raw[key], `foldCounts.${key} matches raw`);
  }
  // <details> is NOT open by default.
  assert.ok(/<details class="rcf-readiness-delta-counts__details"(?!\s*open)/.test(html), 'details element not open on first paint');
  // Expanded form shows the per-document list with doc ids present.
  const htmlOpen = renderDeltaCounts({ delta: result.delta, freezeRecord: null, expanded: true });
  assert.ok(/<details class="rcf-readiness-delta-counts__details"\s*open/.test(htmlOpen), 'details open attribute set when expanded');
  assert.ok(htmlOpen.includes('REQ-010'), 'changed doc id present when expanded');
  assert.ok(htmlOpen.includes('REQ-011'), 'added doc id present when expanded');
  // AC-18005-3 names the per-document list "with its diff widgets":
  // the expanded form groups the ids by bucket (changed / added /
  // briefSince / impacted / impactedFbs) so the ids are legible on
  // their own. Each bucket contains its ids as list items.
  // The expanded block must mark the changed and added buckets
  // explicitly in the DOM so a diff widget can bind to each.
  assert.ok(/changed[\s\S]*?REQ-010/.test(htmlOpen), 'changed bucket contains REQ-010 in expanded details');
  assert.ok(/added[\s\S]*?REQ-011/.test(htmlOpen), 'added bucket contains REQ-011 in expanded details');
  // Closed form has the summary line (shown by the browser when details is closed)
  // but NOT the per-document list markup outside the details element.
  const beforeDetails = html.slice(0, html.indexOf('<details'));
  assert.ok(!beforeDetails.includes('REQ-010'), 'doc id must only live inside details');
  assert.ok(!beforeDetails.includes('REQ-011'), 'doc id must only live inside details');
});

// ---- AC-18005-4 ---------------------------------------------------------

test('AC-18005-4 happy: engineer register has no For-engineers DocRow wrapper and every engineer item is present in a named block', () => {
  const result = readinessFixture();
  const html = renderReadinessPanel(result, { profile: 'register: engineer' });
  // No For-engineers DocRow wrapper, no stage chips, no stage detail.
  assert.doesNotMatch(html, /class="rcf-po-engineer"/);
  assert.doesNotMatch(html, /class="rcf-readiness-chips"/);
  assert.doesNotMatch(html, /class="rcf-readiness-stage-detail"/);
  // Every engineer id (from the fixture's readyToBuild blockedBy) is in the DOM.
  const engBlockers = result.levels.readyToBuild.blockedBy.filter((b) => b.persona === 'engineer');
  for (const b of engBlockers) {
    for (const id of b.ids) {
      assert.ok(html.includes(id), `engineer id ${id} present in panel`);
    }
  }
  // Named blocks: a stage grid (overview), a blocking table (sub-panel),
  // a coverage sub-panel, decisions, freeze-state.
  assert.match(html, /data-rcf-table="verdict-grid"/);
  assert.match(html, /data-rcf-subpanel="blocking"/);
  assert.match(html, /data-rcf-subpanel="coverage"/);
  assert.match(html, /class="rcf-readiness-decisions"/);
  assert.match(html, /class="rcf-readiness-freeze-state"/);
  // Next action is a named block on the engineer surface (AC-18005-4
  // enumerates it explicitly). Plain words, no command text, no Run
  // affordance; the chain stage/check ride in data- attributes only.
  assert.match(html, /class="rcf-readiness-next-actions"[^>]*data-rcf-register="engineer"/);
  const fx = readinessFixtureWithNextAction();
  const htmlWithNext = renderReadinessPanel(fx, { profile: 'register: engineer' });
  assert.match(htmlWithNext, /data-rcf-persona="engineer"[^>]*data-rcf-stage="D5"[^>]*data-rcf-check="d5:tree"/);
  assert.ok(htmlWithNext.includes('resolve the d5 failing items in the blocking table'));
  // No shell command text ever: no "pnpm rcf", no "rcf define", no
  // nextAction.command surface (AC-18003-7 extension).
  assert.doesNotMatch(htmlWithNext, /pnpm rcf/);
  assert.doesNotMatch(htmlWithNext, /nextAction\.command/);
});

function readinessFixtureWithNextAction() {
  const r = readinessFixture();
  r.personas.engineer.nextAction = { stage: 'D5', check: 'd5:tree', ids: ['D5:item1', 'D5:item2'] };
  r.personas.productOwner.nextAction = { stage: 'D1', check: 'd1:tree', ids: ['D1:item1'] };
  return r;
}

// ---- AC-18005-5 ---------------------------------------------------------

test('AC-18005-5 happy: freeze state words - names failing gates when not ready; names what a freeze records when ready', () => {
  const notReady = readinessFixture({ freezeable: false });
  const ready = readinessFixture({ freezeable: true });
  const notReadyHtml = renderReadinessPanel(notReady, { profile: 'register: productOwner' });
  const readyHtml = renderReadinessPanel(ready, { profile: 'register: productOwner' });
  // Not ready: block names failing gates in plain words with a per-gate row.
  assert.match(notReadyHtml, /data-rcf-freezeable="no"/);
  for (const b of notReady.levels.readyToBuild.blockedBy) {
    assert.ok(notReadyHtml.includes(`data-rcf-gate="${b.gate}"`), `gate ${b.gate} listed`);
  }
  assert.match(notReadyHtml, /On me/);
  assert.match(notReadyHtml, /On engineers/);
  // No freeze button; no CLI command text in the readiness panel.
  assert.doesNotMatch(notReadyHtml, /rcf-readiness-freeze-now__btn/);
  assert.doesNotMatch(notReadyHtml, /Freeze now/);
  assert.doesNotMatch(notReadyHtml, /pnpm rcf/);
  assert.doesNotMatch(notReadyHtml, /rcf define/);
  // Ready: states what a freeze would record (hash, timestamp, note, counts, acked gates)
  assert.match(readyHtml, /data-rcf-freezeable="yes"/);
  assert.match(readyHtml, /Ready to freeze/);
  assert.match(readyHtml, /tree hash/);
  assert.match(readyHtml, /timestamp/);
  assert.match(readyHtml, /counts/);
  assert.match(readyHtml, /acknowledged gates/);
  assert.doesNotMatch(readyHtml, /rcf-readiness-freeze-now__btn/);
});

// ---- AC-18005-6 ---------------------------------------------------------

test('AC-18005-6 edge: acknowledged cell state comes from stages[].state and the ack reason via one helper', () => {
  const stages = readinessFixture().stages;
  // Real freeze records write the ack reason under gates[g].at.reason
  // (see src/cli/freeze.js buildGatesEntry / mergeAckedGates). The
  // helper also accepts the legacy flat shape as a fallback.
  const freezeRecord = { gates: { 'define.probe': { state: 'acknowledged', at: { hash: 'def', reason: 'risk accepted at a854a5fc' } } } };
  const d6 = stages.find((s) => s.stage === 'D6');
  const treeCell = buildCell(d6, 'tree', freezeRecord);
  assert.equal(treeCell.state, 'acknowledged', 'tree cell is acknowledged');
  assert.equal(treeCell.reason, 'risk accepted at a854a5fc', 'reason from freezeRecord.gates via helper');
  // reasonForCell is the single helper the grid uses - direct call matches.
  assert.equal(reasonForCell(d6, 'acknowledged', freezeRecord), 'risk accepted at a854a5fc');
  // Non-acknowledged / non-notApplicable states return no reason.
  assert.equal(reasonForCell(d6, 'passed', freezeRecord), undefined);
  assert.equal(reasonForCell(d6, 'failing', freezeRecord), undefined);
  // notApplicable reads stages[].reason, not freezeRecord.
  const d8 = stages.find((s) => s.stage === 'D8');
  assert.equal(reasonForCell(d8, 'notApplicable', freezeRecord), 'tree already freezable');
  // Render: reason surfaces as the cell's title (hover).
  const html = renderVerdictGrid({ stages, freezeRecord });
  assert.ok(/data-rcf-stage="D6"[\s\S]*?data-rcf-cell-state="acknowledged"[\s\S]*?title="risk accepted at a854a5fc"/.test(html), 'acknowledged cell carries the reason as a title');
});

// ---- AC-18005-7 ---------------------------------------------------------

test('AC-18005-7 must-not: embed + <720px keeps tables stacked and SubTabStrip inside the panel', () => {
  // The server-rendered markup puts the SubTabStrip INSIDE the readiness
  // panel wrapper <div.rcf-readiness-panel>, not above the tabs row.
  const html = renderReadinessPanel(readinessFixture(), { profile: null });
  const panelStart = html.indexOf('<div class="rcf-readiness-panel"');
  assert.ok(panelStart !== -1, 'readiness-panel wrapper present');
  const stripIdx = html.indexOf('data-rcf-subtabstrip="readiness"');
  assert.ok(stripIdx > panelStart, 'SubTabStrip sits inside the readiness panel wrapper');
  // CSS: narrow-width rule stacks the grid table and keeps the strip
  // horizontally scrollable within the panel.
  assert.ok(/@media \(max-width: 720px\)[\s\S]*?#tab-readiness \.rcf-subtabs[\s\S]*?overflow-x: auto/.test(STYLE_SRC), 'narrow stack rule for the sub-tab strip');
  assert.ok(/@media \(max-width: 720px\)[\s\S]*?\.rcf-readiness-grid__table thead \{\s*display: none/.test(STYLE_SRC), 'narrow stacks the grid table');
  // Embed rule: same stack rules fire under data-embed="1" regardless
  // of width (viewer embedded in a host side-panel).
  assert.ok(/\[data-embed="1"\] #tab-readiness \.rcf-subtabs[\s\S]*?overflow-x: auto/.test(STYLE_SRC), 'embed stacks the strip');
  assert.ok(/\[data-embed="1"\] \.rcf-readiness-grid__table thead \{\s*display: none/.test(STYLE_SRC), 'embed stacks the grid table');
  // Delta tiles collapse from 6 columns to 2 under both branches.
  assert.ok(/@media \(max-width: 720px\)[\s\S]*?\.rcf-readiness-delta-counts__tiles \{ grid-template-columns: repeat\(2/.test(STYLE_SRC), 'narrow collapses the delta tiles');
  assert.ok(/\[data-embed="1"\] \.rcf-readiness-delta-counts__tiles[\s\S]*?grid-template-columns: repeat\(2/.test(STYLE_SRC), 'embed collapses the delta tiles');
  // AC-18005-7 is "no table forces horizontal page scroll" over
  // every table on the Readiness tab, not just the stage grid. Each
  // table has its own stack-at-narrow rule in style.css; assert the
  // rule exists for the four named tables (questions / blocking,
  // thin requirements, coverage unresolved-pointers).
  assert.ok(/@media \(max-width: 720px\)[\s\S]*?\.rcf-cmd-table__table thead \{\s*display: none/.test(STYLE_SRC), 'narrow stacks the questions / blocking tables (shared .rcf-cmd-table__table)');
  assert.ok(/@media \(max-width: 720px\)[\s\S]*?\.rcf-thin-reqs__table thead \{\s*display: none/.test(STYLE_SRC), 'narrow stacks the thin-requirements table');
  assert.ok(/@media \(max-width: 720px\)[\s\S]*?\.rcf-cov-summary__unresolved-table thead \{\s*display: none/.test(STYLE_SRC), 'narrow stacks the coverage unresolved-pointers table');
  // Rendered panel carries each named table surface so the stack
  // rules bind to real elements, not dead CSS.
  const panelHtml = renderReadinessPanel(readinessFixture(), { profile: null });
  assert.match(panelHtml, /data-rcf-table="questions"/);
  assert.match(panelHtml, /data-rcf-table="blocking"/);
  assert.match(panelHtml, /class="rcf-cov-summary"|rcf-cov-summary__totals/);
  // thin-reqs table shows only when buildThinReqRows returns rows,
  // which the fixture does not drive; its presence is covered by the
  // dedicated AC-18002-5 test in readiness-tab.test.js. The CSS rule
  // above already pins the stack-at-narrow behaviour for its class.
});

// ---- AC-18005-8 ---------------------------------------------------------

test('AC-18005-8 failure: unknown sub= drops to overview and is removed from the hash', () => {
  // The applyReadinessHash branch in page-init.js:
  //   - treats an unknown sub= as "overview"
  //   - rewrites the hash in place (history.replaceState) so sub=<junk>
  //     is removed from the URL after the fallback.
  // readinessHashFragment() emits only `#tab=readiness` for overview
  // (sub= is omitted when sub === 'overview'), which is how the drop
  // takes effect.
  const src = PAGE_INIT_SRC;
  // The known list is READINESS_SUBS; unknown falls back to overview.
  assert.ok(/var sub = known \? raw : 'overview';/.test(src), 'unknown sub= falls back to overview');
  // activateReadinessSub coerces unknown to overview defensively.
  assert.ok(/if \(READINESS_SUBS\.indexOf\(sub\) === -1\) sub = 'overview';/.test(src), 'activateReadinessSub defends against unknown sub keys');
  // The hash is rewritten in place (replaceState) when the input had
  // an unknown sub so the junk value never persists.
  assert.ok(/if \(!known && params && params\.sub\) \{\s*try \{\s*if \(window\.history && typeof window\.history\.replaceState === 'function'\)/.test(src), 'replaceState rewrites the hash when sub= was unknown');
  // readinessHashFragment emits `#tab=readiness` (no sub=) for overview,
  // so a replaceState with that fragment removes sub= from the URL.
  assert.ok(/if \(sub && sub !== 'overview'\) parts\.push\('sub=' \+ encodeURIComponent\(sub\)\);/.test(src), 'overview is encoded without a sub= slot');

  // Runtime binding: an unknown sub= drops to overview AND the hash
  // is rewritten in place. Boot with hash=sub=bogus, invoke the
  // router, and check both outcomes.
  const dom = bootPageInitWithProbe({ hash: '#tab=readiness&sub=bogus' });
  assert.equal(typeof dom.__probe.applyReadinessHash, 'function', 'applyReadinessHash exposed');
  dom.__probe.applyReadinessHash({ tab: 'readiness', sub: 'bogus' });
  assert.ok(!dom.panels.overview.hasAttribute('hidden'), 'overview active on unknown sub');
  assert.ok(dom.panels.questions.hasAttribute('hidden'), 'questions hidden on unknown sub');
  // replaceState wrote a hash with no sub= in it (readinessHashFragment
  // omits sub= when it equals overview).
  const replaced = dom.history._entries.filter((e) => e[0] === 'replace');
  assert.ok(replaced.length >= 1, 'replaceState called at least once on unknown sub');
  const url = replaced[replaced.length - 1][1];
  assert.ok(/#tab=readiness/.test(url), 'rewrite preserves tab=readiness');
  assert.ok(!/sub=bogus/.test(url), 'rewrite drops the bogus sub value');

  // Malformed sub= (bare % is an incomplete escape) also falls back
  // to overview without throwing: parseHashParams returns the raw
  // string and applyReadinessHash catches the URIError.
  const dom2 = bootPageInitWithProbe({ hash: '#tab=readiness&sub=%' });
  dom2.__probe.applyReadinessHash({ tab: 'readiness', sub: '%' });
  assert.ok(!dom2.panels.overview.hasAttribute('hidden'), 'malformed sub= still activates overview');
});
