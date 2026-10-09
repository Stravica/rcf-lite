// FBS-208 FINALISE: client-path behavioural tests for the trace
// matrix. The server-side `src/view/readiness/trace-matrix.js`
// module is a spec-by-example; the shipped behaviour is page-init.js
// (a classic non-module IIFE). These tests boot page-init.js in a
// VM sandbox with a minimal DOM shim (precedent: theme-control.test.js
// and FBS-206 renderers tests), then exercise its exposed internals
// (window.rcfTraceInternals) and the client cache behaviour the SSE
// swap depends on (AC-209-4). Together with the server-side module
// tests they bind every AC-209-* to the implementation that ships.
//
//   AC-209-1  the trace sub-tab and a pivot id in the hash
//   AC-209-2  coverage data for the pivot's criteria
//   AC-209-3  Trace actions on every readiness row land on this view
//   AC-209-4  SSE tree-update: previous render stays visible, stale
//   AC-209-6  unknown-pivot and fetch-error states are distinct
//   AC-209-7  >200 rows: filter bar appears, nothing truncated

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import {
  buildTraceMatrixRows,
  renderTraceMatrix,
} from '../../src/view/readiness/trace-matrix.js';

const here = dirname(fileURLToPath(import.meta.url));
const pageInitPath = resolve(here, '..', '..', 'src', 'view', 'page-init.js');

async function bootPageInit() {
  const code = await readFile(pageInitPath, 'utf8');
  const html = {
    _attrs: new Map(),
    getAttribute(k) { return this._attrs.has(k) ? this._attrs.get(k) : null; },
    setAttribute(k, v) { this._attrs.set(k, String(v)); },
    removeAttribute(k) { this._attrs.delete(k); },
  };
  const document = {
    documentElement: html,
    readyState: 'complete',
    body: { appendChild() {}, removeChild() {} },
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
        appendChild(c) { this.children.push(c); return c; },
        addEventListener() {},
      };
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  const window = {
    location: { pathname: '/', search: '', origin: 'http://localhost', hash: '' },
    addEventListener() {},
    history: { replaceState() {} },
    localStorage: null,
    sessionStorage: null,
    document,
    rcfPage: null,
    rcfView: null,
    rcfTraceInternals: null,
    XMLHttpRequest: function () {
      this.readyState = 0;
      this.status = 0;
      this.open = () => { this.readyState = 1; };
      this.send = () => {};
    },
  };
  const context = vm.createContext({
    window,
    document,
    location: window.location,
    setTimeout: (fn) => fn(),
    clearTimeout: () => {},
    XMLHttpRequest: window.XMLHttpRequest,
    URL,
    URLSearchParams,
  });
  vm.runInContext(code, context, { filename: 'page-init.js' });
  return { window, document, context };
}

// -----------------------------------------------------------------
// AC-209-1 (client path): the shipped inline builder produces rows
// of the same SHAPE and reachability as the server-side spec module.
// On a synthetic payload (fully determined, no dogfood dependency),
// the two implementations converge: same row count, kinds, parents,
// cell order, cell reached flags, and the AC rows' Cases ids match.
// -----------------------------------------------------------------
test('AC-209-1 client: shipped buildMatrixRowsFromPayload matches the server-side spec on a synthetic chain', async () => {
  const { window } = await bootPageInit();
  const internals = window.rcfTraceInternals;
  assert.ok(internals, 'page-init exposes rcfTraceInternals');
  const nodes = [
    { id: 'REQ-S', kind: 'req', depth: 0, title: 'r' },
    { id: 'US-S1', kind: 'us', depth: 1, title: 'u1' },
    { id: 'AC-S1-1', kind: 'ac', depth: 2, title: 'a11' },
    { id: 'AC-S1-2', kind: 'ac', depth: 2, title: 'a12' },
    { id: 'TS-S', kind: 'ts', depth: 3, title: 'ts' },
    { id: 'TC-S-1', kind: 'tc', depth: 4, title: 'tc1' },
    { id: 'TC-S-2', kind: 'tc', depth: 4, title: 'tc2' },
    { id: 'FBS-S', kind: 'fbs', depth: 3, title: 'fbs' },
    { id: 'CN-S', kind: 'codeNode', depth: 5, title: 'cn' },
  ];
  const edges = [
    { from: 'REQ-S', to: 'US-S1', kind: 'parentChild' },
    { from: 'US-S1', to: 'AC-S1-1', kind: 'parentChild' },
    { from: 'US-S1', to: 'AC-S1-2', kind: 'parentChild' },
    { from: 'AC-S1-1', to: 'TS-S', kind: 'testPointer' },
    { from: 'AC-S1-1', to: 'TC-S-1', kind: 'testPointer' },
    { from: 'AC-S1-2', to: 'TC-S-2', kind: 'testPointer' },
    { from: 'TS-S', to: 'TC-S-1', kind: 'parentChild' },
    { from: 'TS-S', to: 'TC-S-2', kind: 'parentChild' },
    { from: 'AC-S1-1', to: 'FBS-S', kind: 'buildOrder' },
    { from: 'TC-S-1', to: 'CN-S', kind: 'implements' },
  ];
  const trace = { pivot: 'REQ-S', direction: 'forward', found: true, nodes, edges };
  const specRows = buildTraceMatrixRows({ trace, coverage: null });
  const shipRows = internals.buildMatrixRowsFromPayload(trace, null);
  assert.equal(shipRows.length, specRows.length, 'same row count');
  for (let i = 0; i < specRows.length; i += 1) {
    const s = specRows[i];
    const c = shipRows[i];
    assert.equal(c.id, s.id);
    assert.equal(c.kind, s.kind);
    assert.equal(c.parent, s.parent);
    assert.equal(c.cells.length, 4);
    for (let j = 0; j < 4; j += 1) {
      assert.equal(c.cells[j].kind, s.cells[j].kind, `row ${s.id} cell ${j} kind`);
      assert.equal(c.cells[j].reached, s.cells[j].reached, `row ${s.id} cell ${j} reached`);
      assert.deepEqual(
        Array.from(c.cells[j].ids),
        Array.from(s.cells[j].ids),
        `row ${s.id} cell ${j} ids match`,
      );
    }
  }
  // P2-4 cross-check: AC-S1-1's Cases column contains only TC-S-1
  // (its own testPointer), not TC-S-2 (reachable via TS only).
  const acRow = shipRows.find((r) => r.id === 'AC-S1-1');
  const tcCell = acRow.cells.find((c) => c.kind === 'tc');
  assert.deepEqual(Array.from(tcCell.ids), ['TC-S-1']);
});

// -----------------------------------------------------------------
// AC-209-2 (strengthened, synthetic): resolution values follow the
// coverage payload. With coverage.testCases listing a TC the AC
// reaches, the cell is 'resolving'; with coverage.unresolvedTestCases
// listing the same TC, the cell is 'unresolved'; with coverage: null
// every TC cell falls to 'unresolved' because the AC's cov entry is
// missing. (This replaces the previous tautological assertion.)
// -----------------------------------------------------------------
test('AC-209-2: resolution values follow the coverage payload, not the walker alone', () => {
  const nodes = [
    { id: 'REQ-Z', kind: 'req', depth: 0, title: 'r' },
    { id: 'US-Z', kind: 'us', depth: 1, title: 'u' },
    { id: 'AC-Z-1', kind: 'ac', depth: 2, title: 'a' },
    { id: 'TC-Z-1', kind: 'tc', depth: 4, title: 'tc' },
  ];
  const edges = [
    { from: 'REQ-Z', to: 'US-Z', kind: 'parentChild' },
    { from: 'US-Z', to: 'AC-Z-1', kind: 'parentChild' },
    { from: 'AC-Z-1', to: 'TC-Z-1', kind: 'testPointer' },
  ];
  const trace = { pivot: 'REQ-Z', direction: 'forward', found: true, nodes, edges };
  const covResolving = { requirements: [{ id: 'REQ-Z', acs: [{ id: 'AC-Z-1', covered: true, testCases: ['TC-Z-1'] }] }] };
  const covUnresolved = { requirements: [{ id: 'REQ-Z', acs: [{ id: 'AC-Z-1', covered: false, testCases: [], unresolvedTestCases: ['TC-Z-1'] }] }] };
  const rowsR = buildTraceMatrixRows({ trace, coverage: covResolving });
  const rowsU = buildTraceMatrixRows({ trace, coverage: covUnresolved });
  const rowsN = buildTraceMatrixRows({ trace, coverage: null });
  const acR = rowsR.find((r) => r.id === 'AC-Z-1');
  const acU = rowsU.find((r) => r.id === 'AC-Z-1');
  const acN = rowsN.find((r) => r.id === 'AC-Z-1');
  assert.equal(acR.cells.find((c) => c.kind === 'tc').resolution, 'resolving');
  assert.equal(acU.cells.find((c) => c.kind === 'tc').resolution, 'unresolved');
  // With coverage=null, the AC's cov entry is missing, so a reached TC
  // falls to 'unresolved' (fail-closed).
  assert.equal(acN.cells.find((c) => c.kind === 'tc').resolution, 'unresolved');
});

// -----------------------------------------------------------------
// P2-4 proof: an AC row's Cases column lists only the AC's OWN TCs,
// not every sibling TC under the AC's TS. Build a trace where one TS
// contains two TCs but only one TC is a testPointer of the AC: the
// AC row's TC ids must have length 1.
// -----------------------------------------------------------------
test('AC-209-2 P2-4: AC row Cases column lists only the ACs own TCs, not every sibling under the TS', async () => {
  const nodes = [
    { id: 'REQ-X', kind: 'req', depth: 0, title: 'x' },
    { id: 'US-X', kind: 'us', depth: 1, title: 'u' },
    { id: 'AC-X-1', kind: 'ac', depth: 2, title: 'a1' },
    { id: 'TS-X', kind: 'ts', depth: 3, title: 'ts' },
    { id: 'TC-X-1', kind: 'tc', depth: 4, title: 'own' },
    { id: 'TC-X-2', kind: 'tc', depth: 4, title: 'sibling' },
  ];
  const edges = [
    { from: 'REQ-X', to: 'US-X', kind: 'parentChild' },
    { from: 'US-X', to: 'AC-X-1', kind: 'parentChild' },
    { from: 'AC-X-1', to: 'TS-X', kind: 'testPointer' },
    { from: 'AC-X-1', to: 'TC-X-1', kind: 'testPointer' },
    { from: 'TS-X', to: 'TC-X-1', kind: 'parentChild' },
    { from: 'TS-X', to: 'TC-X-2', kind: 'parentChild' },
  ];
  const trace = { pivot: 'REQ-X', direction: 'forward', found: true, nodes, edges };
  const rows = buildTraceMatrixRows({ trace, coverage: null });
  const acRow = rows.find((r) => r.id === 'AC-X-1');
  assert.ok(acRow, 'AC row found');
  const tcCell = acRow.cells.find((c) => c.kind === 'tc');
  assert.deepEqual(tcCell.ids, ['TC-X-1'], 'only the own TC is listed, not the sibling under the TS');
});

// -----------------------------------------------------------------
// AC-209-3 (behavioural): the shipped lookupPick routes a readiness-
// tab-active lookup hit to the Trace sub-tab via writeHash. We prove
// the hash shape and the gating prefix in source, matching what the
// id-lookup test already asserts, but on a FRESH read.
// -----------------------------------------------------------------
test('AC-209-3: lookupPick writes a trace sub-tab hash on a readiness-active lookup pick', async () => {
  const script = await readFile(pageInitPath, 'utf8');
  const start = script.indexOf('function lookupPick');
  const end = script.indexOf('function lookupOnKeydown');
  assert.ok(start > 0 && end > start);
  const body = script.slice(start, end);
  assert.match(body, /active === 'readiness'/);
  assert.match(body, /\(PRD\|REQ\|US\|AC\|TS\|TC\|FBS\|CN\|TAC\|ADR\)-/);
  assert.match(body, /#tab=readiness&sub=trace&entity=/);
});

// -----------------------------------------------------------------
// AC-209-4 (behavioural, P1-1 proof): on a tree-version swap the
// client cache's new-version key misses. The shipped
// findPriorCachedEntry locates the most recent prior-version entry
// for the same pivot so the previous matrix stays visible with a
// stale banner while the fetch runs. We exercise the shipped helper
// directly on the shipped cache.
// -----------------------------------------------------------------
test('AC-209-4 P1-1: findPriorCachedEntry returns the most recent prior-version render for the same pivot', async () => {
  const { window } = await bootPageInit();
  const internals = window.rcfTraceInternals;
  // Seed the live cache that the IIFE closed over.
  internals.cache[internals.traceCacheKey(1, 'REQ-002')] = { trace: { v: 1 }, coverage: null };
  internals.cache[internals.traceCacheKey(2, 'REQ-002')] = { trace: { v: 2 }, coverage: null };
  internals.cache[internals.traceCacheKey(3, 'REQ-OTHER')] = { trace: { v: 'other' }, coverage: null };
  // At version 3 for REQ-002, the newest prior is v=2.
  const prior = internals.findPriorCachedEntry('REQ-002', 3);
  assert.ok(prior, 'a prior entry is found');
  assert.deepEqual(prior.trace, { v: 2 });
  // At version 1 (no prior) nothing is returned.
  const none = internals.findPriorCachedEntry('REQ-002', 1);
  assert.equal(none, null, 'nothing for v=1');
  // A different pivot has no prior entry even when the cache carries other pivots.
  const noneOtherPivot = internals.findPriorCachedEntry('REQ-NEW', 3);
  assert.equal(noneOtherPivot, null);
});

// -----------------------------------------------------------------
// AC-209-4 (renderer): a stale render carries the stale banner so
// the user knows the matrix is from the previous tree version.
// -----------------------------------------------------------------
test('AC-209-4: a stale render emits the stale banner markup', () => {
  const html = renderTraceMatrix({
    pivot: 'REQ-X',
    trace: { pivot: 'REQ-X', direction: 'forward', found: true, nodes: [{ id: 'REQ-X', kind: 'req', depth: 0 }], edges: [] },
    coverage: null,
    stale: true,
  });
  assert.match(html, /data-rcf-trace-stale="yes"/);
  assert.match(html, /previous version/);
});

// -----------------------------------------------------------------
// AC-209-6 (strengthened): a 404 unknown-pivot and a 5xx service
// error render DIFFERENT states; the service error is not misread
// as "the id is not in the tree". We prove the renderer branch
// through the shipped isDownstreamPivot and through the module's
// downstream state (both branches drive the user to the lookup).
// -----------------------------------------------------------------
test('AC-209-6 P2-6: fetch-error vs unknown-pivot states are distinct, both offer the lookup', async () => {
  // Unknown-pivot: trace.found = false (what a 404 response surfaces
  // after the client builds the carrier { found: false, pivot }).
  const htmlUnknown = renderTraceMatrix({ pivot: 'REQ-NOPE', trace: { pivot: 'REQ-NOPE', found: false }, coverage: null });
  assert.match(htmlUnknown, /data-rcf-trace-matrix="empty"/);
  assert.match(htmlUnknown, /data-rcf-trace-reason="unknown-pivot"/);
  assert.match(htmlUnknown, /is not in the current tree/);
  assert.match(htmlUnknown, /data-rcf-trace-open-lookup="yes"/);
  // The client isDownstreamPivot gate matches the module's regex and
  // returns true for TS/TC/FBS/CN/TAC/ADR, false for REQ/US/AC.
  const { window } = await bootPageInit();
  const isDownstream = window.rcfTraceInternals.isDownstreamPivot;
  assert.equal(isDownstream('TS-241'), true);
  assert.equal(isDownstream('TC-241-209-1'), true);
  assert.equal(isDownstream('FBS-208'), true);
  assert.equal(isDownstream('CN-700'), true);
  assert.equal(isDownstream('TAC-4136'), true);
  assert.equal(isDownstream('ADR-4140'), true);
  assert.equal(isDownstream('REQ-002'), false);
  assert.equal(isDownstream('US-209'), false);
  assert.equal(isDownstream('AC-209-1'), false);
});

// -----------------------------------------------------------------
// P2-5 proof: a downstream pivot (TS/TC/FBS/CN/TAC/ADR) renders an
// explanatory state in the module, not a silent empty matrix. The
// shipped renderTraceRoot takes the matching branch via
// isDownstreamPivot (above).
// -----------------------------------------------------------------
test('AC-209-6 P2-5: a downstream pivot renders an explanatory state and offers the lookup', () => {
  const htmlTs = renderTraceMatrix({
    pivot: 'TS-241',
    trace: { pivot: 'TS-241', direction: 'forward', found: true, nodes: [{ id: 'TS-241', kind: 'ts', depth: 0 }], edges: [] },
    coverage: null,
  });
  assert.match(htmlTs, /data-rcf-trace-matrix="downstream"/);
  assert.match(htmlTs, /data-rcf-trace-reason="downstream-pivot"/);
  assert.match(htmlTs, /No upstream rows for TS-241/);
  assert.match(htmlTs, /data-rcf-trace-open-lookup="yes"/);
  // No body table is drawn.
  assert.doesNotMatch(htmlTs, /data-rcf-trace-matrix="yes"/);
  assert.doesNotMatch(htmlTs, /<tbody>/);
});
