// Track B preflight seam pickup test (spec §3.2, Track A preflight
// addendum §A.2). Proves the ui-baseline init flow reads any
// preflight-recorded design-shape answer whose write path targets
// `defaults.*` and applies it as an override on the fresh baseline;
// the corresponding baselineAcOptOuts ledger entry stays in place as
// the durable record either way.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { initProject } from '#core/store/init.js';
import { walkTree } from '#core/store';

import {
  composeUiBaselineRecord,
  preflightSeamOverrides,
  writeUiBaselineRecord,
} from '../../src/ui-baseline/index.js';

async function makeProject(manifestExtras) {
  const root = await mkdtemp(join(tmpdir(), 'rcf-seam-'));
  await initProject({ projectRoot: root, projectName: 'seam-test' });
  if (manifestExtras) {
    const manifestPath = join(root, 'rcf', 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    await writeFile(manifestPath, JSON.stringify({ ...manifest, ...manifestExtras }, null, 2));
  }
  return root;
}

test('preflightSeamOverrides + writeUiBaselineRecord: apiOnly answer lands as authFlow.htmlLoginPageRequired=false', async () => {
  const projectRoot = await makeProject({
    preFlightConfig: [{
      id: 'pfc-2026-07-30-001',
      createdAt: '2026-07-30T00:00:00Z',
      prdId: 'PRD-001',
      servicesInScope: [],
      operatorAckAt: '2026-07-30T00:00:00Z',
      designShapeAnswers: [{ questionId: 'auth.htmlLoginPage', answer: 'apiOnly', answeredAt: '2026-07-30T00:00:00Z' }],
    }],
    baselineAcOptOuts: [{
      id: 'boo-2026-07-30-001',
      createdAt: '2026-07-30T00:00:00Z',
      baselineKey: 'auth.htmlLoginPage',
      scope: 'project',
      reason: 'SDK-only clients; no HTML flow ships in v1',
      operatorAckAt: '2026-07-30T00:00:00Z',
      linkedPreFlightConfigRef: 'pfc-2026-07-30-001#designShapeAnswers.auth.htmlLoginPage',
    }],
  });
  const { tree } = await walkTree({ projectRoot });
  const overrides = preflightSeamOverrides(tree.manifest);
  assert.equal(overrides['authFlow.htmlLoginPageRequired'], false);

  const record = composeUiBaselineRecord({
    manifest: tree.manifest,
    prdId: 'PRD-001',
    overrides,
    now: new Date('2026-07-30T15:00:00Z'),
  });
  assert.equal(record.defaults.authFlow.htmlLoginPageRequired, false);

  const write = await writeUiBaselineRecord({ projectRoot, tree, record });
  assert.equal(write?.kind, undefined);
  const persisted = JSON.parse(await readFile(join(projectRoot, 'rcf', 'manifest.json'), 'utf8'));
  assert.equal(persisted.uiBaseline.defaults.authFlow.htmlLoginPageRequired, false);
  // The pre-existing opt-out ledger entry is preserved.
  assert.equal(persisted.baselineAcOptOuts[0].linkedPreFlightConfigRef, 'pfc-2026-07-30-001#designShapeAnswers.auth.htmlLoginPage');
});

test('preflightSeamOverrides: htmlLoginPage answer preserves the ruled default (true)', async () => {
  const overrides = preflightSeamOverrides({
    preFlightConfig: [{
      id: 'pfc-2026-07-30-001',
      designShapeAnswers: [{ questionId: 'auth.htmlLoginPage', answer: 'htmlLoginPage', answeredAt: 'x' }],
    }],
  });
  assert.equal(overrides['authFlow.htmlLoginPageRequired'], true);
});

// Track B review N-4: generality proof. `preflightSeamOverrides` reads
// `uiBaselineWritePath` + `uiBaselineWriteValue` off the catalogue's
// per-choice metadata rather than hard-coding the auth.htmlLoginPage
// question. Any answered question whose choice carries a write path
// flows through the seam unchanged; a future Track C+D catalogue
// addition does not need a wiring change here.

test('preflightSeamOverrides: generalises across catalogue entries (synthetic second question via injected catalogue)', async () => {
  const syntheticCatalogue = [
    {
      id: 'auth.htmlLoginPage',
      scope: 'reqScoped',
      trigger: () => true,
      prompt: 'HTML login page or API-only?',
      choices: [
        { value: 'htmlLoginPage', display: 'HTML', triggersOptOut: false, uiBaselineWritePath: 'defaults.authFlow.htmlLoginPageRequired', uiBaselineWriteValue: true },
        { value: 'apiOnly', display: 'API', triggersOptOut: true, uiBaselineWritePath: 'defaults.authFlow.htmlLoginPageRequired', uiBaselineWriteValue: false },
      ],
      reasonMinLength: 20,
      baselineKey: 'auth.htmlLoginPage',
    },
    {
      id: 'ui.themePolicy',
      scope: 'reqScoped',
      trigger: () => true,
      prompt: 'Which theme policy?',
      choices: [
        { value: 'lightOnly', display: 'Light only', triggersOptOut: false, uiBaselineWritePath: 'defaults.themeMode', uiBaselineWriteValue: 'light-only' },
        { value: 'darkOnly', display: 'Dark only', triggersOptOut: false, uiBaselineWritePath: 'defaults.themeMode', uiBaselineWriteValue: 'dark-only' },
      ],
      reasonMinLength: 20,
      baselineKey: 'ui.themePolicy',
    },
  ];
  const overrides = preflightSeamOverrides({
    preFlightConfig: [{
      id: 'pfc-2026-07-30-001',
      designShapeAnswers: [
        { questionId: 'auth.htmlLoginPage', answer: 'apiOnly', answeredAt: 'x' },
        { questionId: 'ui.themePolicy', answer: 'darkOnly', answeredAt: 'x' },
      ],
    }],
  }, syntheticCatalogue);
  assert.equal(overrides['authFlow.htmlLoginPageRequired'], false);
  assert.equal(overrides['themeMode'], 'dark-only');
});

test('preflightSeamOverrides: an unknown questionId is silently skipped (catalogue is the source of truth)', async () => {
  const overrides = preflightSeamOverrides({
    preFlightConfig: [{
      id: 'pfc-2026-07-30-001',
      designShapeAnswers: [
        { questionId: 'not.in.catalogue', answer: 'foo', answeredAt: 'x' },
        { questionId: 'auth.htmlLoginPage', answer: 'htmlLoginPage', answeredAt: 'x' },
      ],
    }],
  });
  assert.equal(overrides['authFlow.htmlLoginPageRequired'], true);
  assert.equal(Object.keys(overrides).length, 1);
});

test('preflightSeamOverrides: an answer whose choice has no uiBaselineWritePath is silently skipped', async () => {
  const syntheticCatalogue = [
    {
      id: 'ui.noWritePath',
      scope: 'reqScoped',
      trigger: () => true,
      prompt: '?',
      choices: [
        // No uiBaselineWritePath on this choice - the answer is stored in
        // preflight for later use but does not seed a baseline default.
        { value: 'yes', display: 'Yes', triggersOptOut: false },
      ],
      reasonMinLength: 20,
      baselineKey: 'ui.noWritePath',
    },
  ];
  const overrides = preflightSeamOverrides({
    preFlightConfig: [{
      id: 'pfc-2026-07-30-001',
      designShapeAnswers: [{ questionId: 'ui.noWritePath', answer: 'yes', answeredAt: 'x' }],
    }],
  }, syntheticCatalogue);
  assert.deepEqual(overrides, {});
});
