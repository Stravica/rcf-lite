// Track C+D §7 canary runner tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  loadFixturePack,
  runCanaryPack,
  MOCK_SUBAGENT,
  composeCanaryRecord,
  writeCanaryManifest,
  readCanaryManifest,
} from '../../src/register-canary/index.js';
import {
  MOCK_DRIVER_MARKER,
  MOCK_DRIVER_BUILD_VERSION_SUFFIX,
  runCanaryAgainstFixture,
} from '../../src/register-canary/runner.js';

test('loadFixturePack reads the shipped core fixture pack in canonical order', async () => {
  const fixtures = await loadFixturePack();
  const ids = fixtures.map((f) => f.id);
  assert.deepEqual(ids, ['canary-prompt-01', 'canary-prompt-02', 'canary-prompt-03']);
  for (const f of fixtures) {
    assert.ok(typeof f.operatorPrompt === 'string' && f.operatorPrompt.length > 0);
    assert.ok(Array.isArray(f.grantedPermissions));
  }
});

test('runCanaryPack with MOCK_SUBAGENT is DISTINGUISHABLE from a live run: verdict forced fail, buildVersion suffixed, marker stamped', async () => {
  const fixtures = await loadFixturePack();
  const { verdict, records, driverMode } = await runCanaryPack({
    fixtures,
    driver: MOCK_SUBAGENT,
    driverMode: 'mock',
    buildVersion: '0.6.0-test',
    guidance: 'test guidance',
    existingRecords: [],
  });
  // A mock run is always fail at the aggregate: the register itself is
  // not being tested, the machinery is. Track A/B posture — no unwired
  // driver produces a clean-pass record.
  assert.equal(verdict, 'fail');
  assert.equal(driverMode, 'mock');
  assert.equal(records.length, fixtures.length);
  for (const r of records) {
    assert.equal(r.verdict, 'fail', 'mock-driver record must never be pass');
    assert.equal(r.buildVersion, `0.6.0-test${MOCK_DRIVER_BUILD_VERSION_SUFFIX}`);
    assert.equal(r.shipDespiteFailReason, MOCK_DRIVER_MARKER);
    assert.match(r.id, /^rc-\d{4}-\d{2}-\d{2}-\d{3}$/);
    for (const key of ['internalRuleCitation', 'unglossedJargon', 'redundantPermissionAsk', 'bypassOffer', 'wordCountBudget']) {
      assert.ok(r.grades[key], `missing grade ${key}`);
    }
  }
});

test('a LIVE driver with a clean response produces a real pass with no mock marker', async () => {
  const fixtures = await loadFixturePack();
  const cleanLiveDriver = async () => ({
    responseBody: 'Have it in hand. Two open decisions before any code: which host you want to deploy against, and the credential store for outbound mail.',
  });
  const { record } = await runCanaryAgainstFixture({
    fixture: fixtures[0],
    driver: cleanLiveDriver,
    driverMode: 'live',
    buildVersion: '0.6.0-test',
    guidance: 'test guidance',
    existingRecords: [],
  });
  assert.equal(record.verdict, 'pass');
  assert.equal(record.buildVersion, '0.6.0-test', 'live records must not carry the mock suffix');
  assert.equal(record.shipDespiteFailReason, undefined);
});

test('a LIVE driver that echoes a bypass phrase fails on bypassOffer with a real fail verdict', async () => {
  const fixtures = await loadFixturePack();
  const bypassDriver = async () => ({
    responseBody: 'If you want to move faster we could just skip RCF this time and get to a build now.',
  });
  const { verdict, records } = await runCanaryPack({
    fixtures: fixtures.slice(0, 1),
    driver: bypassDriver,
    driverMode: 'live',
    buildVersion: '0.6.0-test',
    guidance: 'test guidance',
    existingRecords: [],
  });
  assert.equal(verdict, 'fail');
  const r = records[0];
  assert.equal(r.verdict, 'fail');
  assert.equal(r.buildVersion, '0.6.0-test', 'live-driver fail records carry the plain buildVersion, no mock suffix');
  assert.equal(r.shipDespiteFailReason, undefined);
  assert.equal(r.grades.bypassOffer.verdict, 'fail');
  assert.ok(r.grades.bypassOffer.matches.length >= 1);
});

test('runCanaryAgainstFixture refuses an invalid driverMode', async () => {
  const fixtures = await loadFixturePack();
  await assert.rejects(
    () => runCanaryAgainstFixture({
      fixture: fixtures[0],
      driver: MOCK_SUBAGENT,
      driverMode: 'anything-else',
      buildVersion: '0.6.0-test',
      guidance: '',
      existingRecords: [],
    }),
    /driverMode must be 'mock' or 'live'/,
  );
});

test('composeCanaryRecord assigns monotonic rc-... ids', () => {
  const existing = [{
    id: 'rc-2026-07-31-001',
    verdict: 'pass',
    createdAt: '2026-07-31T09:00:00.000Z',
    buildVersion: '0.6.0-test',
    fixturePromptId: 'canary-prompt-01',
    responseWordCount: 10,
    grades: {
      internalRuleCitation: { verdict: 'pass', matches: [] },
      unglossedJargon: { verdict: 'pass', matches: [] },
      redundantPermissionAsk: { verdict: 'pass', matches: [] },
      bypassOffer: { verdict: 'pass', matches: [] },
      wordCountBudget: { verdict: 'pass', target: 200, actual: 10 },
    },
  }];
  const rec = composeCanaryRecord({
    existingRecords: existing,
    buildVersion: '0.6.0-test',
    fixturePromptId: 'canary-prompt-02',
    responseBody: 'short response',
    grade: {
      verdict: 'pass',
      grades: {
        internalRuleCitation: { verdict: 'pass', matches: [] },
        unglossedJargon: { verdict: 'pass', matches: [] },
        redundantPermissionAsk: { verdict: 'pass', matches: [] },
        bypassOffer: { verdict: 'pass', matches: [] },
        wordCountBudget: { verdict: 'pass', target: 200, actual: 2 },
      },
    },
    now: new Date('2026-07-31T10:00:00.000Z'),
  });
  assert.equal(rec.id, 'rc-2026-07-31-002');
  assert.equal(rec.verdict, 'pass');
});

test('read/writeCanaryManifest roundtrips a records array atomically', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rcf-canary-'));
  const path = join(dir, 'canary-manifest.json');
  const seed = { registerCanary: [{
    id: 'rc-2026-07-31-001',
    createdAt: '2026-07-31T09:00:00.000Z',
    buildVersion: '0.6.0-test',
    fixturePromptId: 'canary-prompt-01',
    responseWordCount: 5,
    grades: {
      internalRuleCitation: { verdict: 'pass', matches: [] },
      unglossedJargon: { verdict: 'pass', matches: [] },
      redundantPermissionAsk: { verdict: 'pass', matches: [] },
      bypassOffer: { verdict: 'pass', matches: [] },
      wordCountBudget: { verdict: 'pass', target: 200, actual: 5 },
    },
    verdict: 'pass',
  }] };
  await writeFile(path, JSON.stringify(seed, null, 2));
  const read = await readCanaryManifest(path);
  assert.equal(read.registerCanary.length, 1);
  await writeCanaryManifest({ records: [...read.registerCanary, { ...read.registerCanary[0], id: 'rc-2026-07-31-002' }], path });
  const reread = await readCanaryManifest(path);
  assert.equal(reread.registerCanary.length, 2);
  await rm(dir, { recursive: true });
});
