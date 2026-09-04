// pack-runner tests (visual round T-0, US-1701 AC-1701-4 / 6).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runProbePacksForFbs } from '../../src/browser-verify/pack-runner.js';
import { aggregateVerdict, composeBrowserVerificationRecord } from '../../src/browser-verify/manifest-writer.js';

function pack({ packName = 'application-datatable-grid-shell', blueprintSlug = 'application-datatable', appliesTo = () => true, checks = [], preChecks = [] } = {}) {
  return {
    packName,
    version: '1.0.0',
    blueprintSlug,
    packAbsPath: `/tmp/${packName}.pack.js`,
    appliesTo,
    boot: null,
    checks,
    preChecks,
  };
}

test('runProbePacksForFbs folds probePacks[] onto the record and the aggregate verdict extension blocks on a block-severity pack fail', async () => {
  const packs = [
    pack({
      packName: 'application-datatable-grid-shell',
      appliesTo: () => true,
      checks: [
        { id: 'AC-17101-1', severity: 'block', description: 'sort', run: async ({ browser }) => ({ verdict: browser === 'pw-stub' ? 'pass' : 'fail' }) },
        { id: 'AC-17101-2', severity: 'block', description: 'aria row', run: async () => ({ verdict: 'fail', detail: 'row order after sort did not match server order' }) },
      ],
    }),
  ];
  const { probePacks } = await runProbePacksForFbs({
    packs,
    fbs: { fbsId: 'FBS-100' },
    uiBaseline: null,
    manifest: null,
    browser: 'pw-stub',
    fetch: null,
    runtimeUrl: 'http://127.0.0.1:3000',
    routes: [{ path: '/dt' }],
    themes: ['light'],
  });
  assert.equal(probePacks.length, 1);
  assert.equal(probePacks[0].packName, 'application-datatable-grid-shell');
  assert.equal(probePacks[0].applicable, true);
  assert.equal(probePacks[0].checks[0].verdict, 'pass');
  assert.equal(probePacks[0].checks[1].verdict, 'fail');
  assert.equal(probePacks[0].checks[1].detail, 'row order after sort did not match server order');

  const record = composeBrowserVerificationRecord({
    manifest: null, fbsId: 'FBS-100', mode: 'agentScreenshotCritique',
    runtimeProfile: 'local-dev', runtimeUrl: 'http://127.0.0.1:3000',
    routesChecked: [{ path: '/dt', screenshotPath: '.rcf/x.png', themeApplied: 'light' }],
    invariantChecks: [{ invariant: 'sharedNavPresent', verdict: 'pass', severity: 'block' }],
    authSmokeChecks: [],
    probePacks,
  });
  assert.equal(record.verdict, 'block');
  assert.equal(record.probePacks.length, 1);
});

test('runProbePacksForFbs records applicable=false when appliesTo returns false and no run is invoked', async () => {
  let ran = false;
  const packs = [
    pack({
      packName: 'application-datatable-not-scoped',
      appliesTo: () => false,
      checks: [
        { id: 'AC-17101-1', severity: 'block', description: 'x', run: async () => { ran = true; return { verdict: 'pass' }; } },
      ],
    }),
  ];
  const { probePacks } = await runProbePacksForFbs({
    packs, fbs: { fbsId: 'FBS-100' }, uiBaseline: null, manifest: null,
    browser: null, fetch: null, runtimeUrl: '', routes: [], themes: [],
  });
  assert.equal(ran, false);
  assert.equal(probePacks[0].applicable, false);
  assert.equal(probePacks[0].checks.length, 0);
  assert.match(probePacks[0].detail, /appliesTo returned false/);
});

test('runProbePacksForFbs honours packNameFilter and returns only the matching pack', async () => {
  const packs = [
    pack({ packName: 'application-datatable-a', appliesTo: () => true, checks: [{ id: 'AC-17101-1', severity: 'block', description: 'a', run: async () => ({ verdict: 'pass' }) }] }),
    pack({ packName: 'application-datatable-b', appliesTo: () => true, checks: [{ id: 'AC-17101-2', severity: 'block', description: 'b', run: async () => ({ verdict: 'pass' }) }] }),
  ];
  const { probePacks } = await runProbePacksForFbs({
    packs, fbs: { fbsId: 'FBS-100' }, uiBaseline: null, manifest: null,
    browser: null, fetch: null, runtimeUrl: '', routes: [], themes: [],
    packNameFilter: 'application-datatable-b',
  });
  assert.equal(probePacks.length, 1);
  assert.equal(probePacks[0].packName, 'application-datatable-b');
});

test('preChecks fast-fail skips browser checks that dependsOn a failing pre-check', async () => {
  let ranTagChecker = false;
  let ranStyleCheck = false;
  let ranAriaCheck = false;
  const packs = [
    pack({
      packName: 'application-datatable-mixed',
      appliesTo: () => true,
      preChecks: [
        { id: 'no-inline-style', severity: 'block', description: 'x', run: async () => { ranStyleCheck = true; return { verdict: 'fail', detail: 'inline style block found' }; } },
      ],
      checks: [
        { id: 'AC-17101-1', severity: 'block', description: 'depends on no-inline-style', dependsOn: 'no-inline-style', run: async () => { ranTagChecker = true; return { verdict: 'pass' }; } },
        { id: 'AC-17101-2', severity: 'warn', description: 'aria pattern (independent)', run: async () => { ranAriaCheck = true; return { verdict: 'pass' }; } },
      ],
    }),
  ];
  const { probePacks } = await runProbePacksForFbs({
    packs, fbs: { fbsId: 'FBS-100' }, uiBaseline: null, manifest: null,
    browser: null, fetch: null, runtimeUrl: '', routes: [], themes: [],
  });
  assert.equal(ranStyleCheck, true);
  assert.equal(ranTagChecker, false, 'browser check depending on the failing pre-check should be skipped');
  assert.equal(ranAriaCheck, true, 'independent browser check should still run');
  const record = probePacks[0];
  assert.equal(record.preChecks[0].verdict, 'fail');
  const skippedCheck = record.checks.find((c) => c.id === 'AC-17101-1');
  assert.equal(skippedCheck.verdict, 'skipped');
  assert.equal(skippedCheck.detail, 'skipped-by-pre-check:no-inline-style');
  const runCheck = record.checks.find((c) => c.id === 'AC-17101-2');
  assert.equal(runCheck.verdict, 'pass');

  const verdict = aggregateVerdict(
    [{ invariant: 'sharedNavPresent', verdict: 'pass', severity: 'block' }],
    [],
    probePacks,
  );
  assert.equal(verdict, 'block', 'block-severity pre-check fail must block ship');
});

test('aggregateVerdict returns warn on a warn-severity pack fail when no block fires', () => {
  const probePacks = [{
    packName: 'application-datatable-x',
    applicable: true,
    checks: [
      { id: 'AC-17101-3', severity: 'warn', verdict: 'fail', detail: 'live-region silent' },
    ],
  }];
  const verdict = aggregateVerdict(
    [{ invariant: 'sharedNavPresent', verdict: 'pass', severity: 'block' }],
    [],
    probePacks,
  );
  assert.equal(verdict, 'warn');
});

test('aggregateVerdict without probePacks arg stays byte-compatible with pre-T-0 callers', () => {
  const verdict = aggregateVerdict(
    [{ invariant: 'sharedNavPresent', verdict: 'pass', severity: 'block' }],
    [{ verdict: 'pass' }],
  );
  assert.equal(verdict, 'pass');
});

test('runProbePacksForFbs treats a check whose run throws as a fail with detail', async () => {
  const packs = [
    pack({
      packName: 'application-datatable-throws',
      appliesTo: () => true,
      checks: [
        { id: 'AC-17101-1', severity: 'block', description: 'x', run: async () => { throw new Error('page.goto failed'); } },
      ],
    }),
  ];
  const { probePacks } = await runProbePacksForFbs({
    packs, fbs: { fbsId: 'FBS-100' }, uiBaseline: null, manifest: null,
    browser: null, fetch: null, runtimeUrl: '', routes: [], themes: [],
  });
  assert.equal(probePacks[0].checks[0].verdict, 'fail');
  assert.match(probePacks[0].checks[0].detail, /check threw: page\.goto failed/);
});
