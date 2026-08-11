// Browser-verify invariants tests (spec §8.3).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  UI_INVARIANTS_V1,
  compareTopLevelStructure,
  foldInvariantsForRecord,
  runInvariantsForCapture,
} from '../../src/browser-verify/invariants.js';

const uiBearingFbs = {
  fbsId: 'FBS-016',
  designStage: {
    navModel: {
      shape: 'shared-persistent',
      routes: [
        { path: '/', label: 'Dashboard', authRequired: true },
        { path: '/monitors', label: 'Monitors', authRequired: true },
      ],
      signedInAsAffordance: true,
    },
    themeAndA11y: { themeMode: 'light-default-with-toggle' },
  },
};

const goodDom = `<!DOCTYPE html>
<html data-theme="light">
  <body>
    <nav>
      <a href="/">Dashboard</a>
      <a href="/monitors" aria-current="page">Monitors</a>
      <button data-theme-toggle aria-label="Switch theme">Theme</button>
      <span>Signed in as owner</span>
      <a href="/logout">Log out</a>
    </nav>
    <style>:focus-visible { outline: 2px solid; }</style>
    <main>Content</main>
  </body>
</html>`;

test('UI_INVARIANTS_V1 is exported as a frozen versioned constant', () => {
  assert.equal(Object.isFrozen(UI_INVARIANTS_V1), true);
  const names = UI_INVARIANTS_V1.map((i) => i.name);
  assert.ok(names.includes('sharedNavPresent'));
  assert.ok(names.includes('activeNavMarked'));
  assert.ok(names.includes('themeToggleVisible'));
});

test('runInvariantsForCapture passes on a clean auth-route DOM with nav, theme toggle, signed-in-as', () => {
  const results = runInvariantsForCapture({
    routePath: '/', themeApplied: 'light', fbs: uiBearingFbs, uiBaseline: null, dom: goodDom, authenticated: true,
  });
  const named = Object.fromEntries(results.map((r) => [r.invariant, r.verdict]));
  assert.equal(named.sharedNavPresent, 'pass');
  assert.equal(named.activeNavMarked, 'pass');
  assert.equal(named.themeToggleVisible, 'pass');
  assert.equal(named.signedInAsAffordance, 'pass');
});

test('runInvariantsForCapture fails sharedNavPresent when <nav> is missing on an auth route', () => {
  const dom = '<html><body><a href="/">Dashboard</a></body></html>';
  const results = runInvariantsForCapture({
    routePath: '/', themeApplied: 'light', fbs: uiBearingFbs, uiBaseline: null, dom, authenticated: true,
  });
  const nav = results.find((r) => r.invariant === 'sharedNavPresent');
  assert.equal(nav.verdict, 'fail');
  assert.equal(nav.severity, 'block');
});

test('runInvariantsForCapture fails activeNavMarked when no aria-current="page" appears', () => {
  const dom = '<html><body><nav><a href="/">D</a><a href="/monitors">M</a></nav></body></html>';
  const results = runInvariantsForCapture({
    routePath: '/', themeApplied: 'light', fbs: uiBearingFbs, uiBaseline: null, dom, authenticated: true,
  });
  const marked = results.find((r) => r.invariant === 'activeNavMarked');
  assert.equal(marked.verdict, 'fail');
});

test('runInvariantsForCapture fails signedInAsAffordance when the affordance is required and missing', () => {
  const dom = '<html><body><nav><a href="/">D</a><a href="/monitors" aria-current="page">M</a></nav></body></html>';
  const results = runInvariantsForCapture({
    routePath: '/', themeApplied: 'light', fbs: uiBearingFbs, uiBaseline: null, dom, authenticated: true,
  });
  const sig = results.find((r) => r.invariant === 'signedInAsAffordance');
  assert.equal(sig.verdict, 'fail');
});

test('themeToggleVisible passes on any of the recognition-set signals', () => {
  const cases = [
    '<html><body><nav data-theme-toggle></nav></body></html>',
    '<html><body><nav><button class="theme-toggle"></button></nav></body></html>',
    '<html><body><nav><button aria-label="Switch theme"></button></nav></body></html>',
    '<html><body><nav><button>Change theme</button></nav></body></html>',
  ];
  for (const dom of cases) {
    const results = runInvariantsForCapture({
      routePath: '/', themeApplied: 'light', fbs: uiBearingFbs, uiBaseline: null, dom, authenticated: true,
    });
    const t = results.find((r) => r.invariant === 'themeToggleVisible');
    assert.equal(t.verdict, 'pass', `expected pass on: ${dom}`);
  }
});

test('themeDefaultsToLight fires only on the light capture and reads data-theme', () => {
  const dark = '<html data-theme="dark"><body><nav></nav></body></html>';
  const results = runInvariantsForCapture({
    routePath: '/', themeApplied: 'light', fbs: uiBearingFbs, uiBaseline: null, dom: dark, authenticated: true,
  });
  const themeDefault = results.find((r) => r.invariant === 'themeDefaultsToLight');
  assert.equal(themeDefault.verdict, 'fail');
  const skipped = runInvariantsForCapture({
    routePath: '/', themeApplied: 'dark', fbs: uiBearingFbs, uiBaseline: null, dom: dark, authenticated: true,
  });
  assert.equal(skipped.find((r) => r.invariant === 'themeDefaultsToLight'), undefined);
});

test('opt-out on themeMode demotes themeDefaultsToLight severity to advisory', () => {
  const dom = '<html data-theme="dark"><body><nav></nav></body></html>';
  const baseline = { defaults: { themeMode: 'light-default-with-toggle' }, operatorOptOuts: [{ field: 'themeMode', reason: 'x', operatorAckAt: 'x' }] };
  const results = runInvariantsForCapture({
    routePath: '/', themeApplied: 'light', fbs: uiBearingFbs, uiBaseline: baseline, dom, authenticated: true,
  });
  const t = results.find((r) => r.invariant === 'themeDefaultsToLight');
  assert.equal(t.severity, 'advisory');
});

test('foldInvariantsForRecord aggregates worst verdict + most-severe severity across captures', () => {
  const perCapture = [
    { routePath: '/', themeApplied: 'light', results: [{ invariant: 'sharedNavPresent', verdict: 'pass', severity: 'block' }] },
    { routePath: '/monitors', themeApplied: 'light', results: [{ invariant: 'sharedNavPresent', verdict: 'fail', severity: 'block', detail: 'no nav' }] },
  ];
  const folded = foldInvariantsForRecord(perCapture);
  const nav = folded.find((f) => f.invariant === 'sharedNavPresent');
  assert.equal(nav.verdict, 'fail');
  assert.equal(nav.severity, 'block');
  assert.match(nav.detail, /\/monitors\[light\]: no nav/);
});

test('compareTopLevelStructure returns pass on a single capture', () => {
  const r = compareTopLevelStructure([{ routePath: '/', dom: '<html><body><nav></nav><main></main></body></html>' }], null);
  assert.equal(r.verdict, 'pass');
});
