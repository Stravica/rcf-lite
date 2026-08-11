// Design substage writer + gate tests (spec §5.5, §6.2).
//
// Uses a temp-project fixture so the writer's on-disk atomic rename
// path is exercised end-to-end. The fixture is a minimal manifest +
// PRD + REQ + US + FBS tree the walker can load.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { initProject } from '#core/store/init.js';
import { walkTree } from '#core/store';

import {
  firstBaselineDisagreement,
  missingDesignStageArtefacts,
  writeJourneyAdd,
  writeMarkComplete,
  writeNavSet,
  writeThemeA11ySet,
} from '../../src/design/index.js';

async function makeTempProject(fbsExtras = {}, manifestExtras = {}) {
  const root = await mkdtemp(join(tmpdir(), 'rcf-design-test-'));
  await initProject({ projectRoot: root, projectName: 'design-test' });
  // Patch the FBS with our test's uiBearing / designStage overrides.
  const fbsPath = join(root, 'rcf', 'fbs', 'fbs-001.json');
  const existing = JSON.parse(await readFile(fbsPath, 'utf8'));
  await writeFile(fbsPath, JSON.stringify({ ...existing, ...fbsExtras }, null, 2));
  if (Object.keys(manifestExtras).length > 0) {
    const manifestPath = join(root, 'rcf', 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    await writeFile(manifestPath, JSON.stringify({ ...manifest, ...manifestExtras }, null, 2));
  }
  return { projectRoot: root };
}

test('writeJourneyAdd appends a journey and writes designStage back to disk', async () => {
  const { projectRoot } = await makeTempProject({ uiBearing: true });
  const { tree } = await walkTree({ projectRoot });
  const result = await writeJourneyAdd({
    projectRoot, tree, fbsId: 'FBS-001',
    journey: {
      id: 'signed-in-owner',
      actor: 'signed-in owner',
      goal: 'see monitor status at a glance',
      steps: ['lands on /', 'sees tiles', 'clicks a monitor'],
    },
  });
  assert.equal(result?.kind, undefined);
  const written = JSON.parse(await readFile(join(projectRoot, 'rcf', 'fbs', 'fbs-001.json'), 'utf8'));
  assert.equal(written.designStage.journeys.length, 1);
  assert.equal(written.designStage.journeys[0].id, 'signed-in-owner');
});

test('writeJourneyAdd refuses a journey id that already exists', async () => {
  const { projectRoot } = await makeTempProject({
    uiBearing: true,
    designStage: { journeys: [{ id: 'dupe', actor: 'x', goal: 'y', steps: ['s1', 's2'] }] },
  });
  const { tree } = await walkTree({ projectRoot });
  const result = await writeJourneyAdd({
    projectRoot, tree, fbsId: 'FBS-001',
    journey: { id: 'dupe', actor: 'x', goal: 'y', steps: ['s1', 's2'] },
  });
  assert.equal(result?.kind, 'usage');
});

test('writeJourneyAdd validates journey shape (id slug + step count 2-8)', async () => {
  const { projectRoot } = await makeTempProject({ uiBearing: true });
  const { tree } = await walkTree({ projectRoot });
  const badId = await writeJourneyAdd({
    projectRoot, tree, fbsId: 'FBS-001',
    journey: { id: 'BAD-ID', actor: 'x', goal: 'y', steps: ['s1', 's2'] },
  });
  assert.equal(badId?.kind, 'usage');
  const tooFew = await writeJourneyAdd({
    projectRoot, tree, fbsId: 'FBS-001',
    journey: { id: 'ok', actor: 'x', goal: 'y', steps: ['s1'] },
  });
  assert.equal(tooFew?.kind, 'usage');
});

test('writeNavSet refuses unknown shape and requires at least one route', async () => {
  const { projectRoot } = await makeTempProject({ uiBearing: true });
  const { tree } = await walkTree({ projectRoot });
  const bad = await writeNavSet({ projectRoot, tree, fbsId: 'FBS-001', shape: 'weird', routes: [{ path: '/', label: 'x', authRequired: true }] });
  assert.equal(bad?.kind, 'usage');
  const noRoutes = await writeNavSet({ projectRoot, tree, fbsId: 'FBS-001', shape: 'shared-persistent', routes: [] });
  assert.equal(noRoutes?.kind, 'usage');
});

test('writeThemeA11ySet requires the contrast-before-palette boolean', async () => {
  const { projectRoot } = await makeTempProject({ uiBearing: true });
  const { tree } = await walkTree({ projectRoot });
  const noBoolean = await writeThemeA11ySet({
    projectRoot, tree, fbsId: 'FBS-001',
    themeMode: 'light-default-with-toggle',
    themeTokensModule: 'src/ui/tokens.ts',
    contrastTestPath: 'test/ui-contrast.test.ts',
  });
  assert.equal(noBoolean?.kind, 'usage');
  const good = await writeThemeA11ySet({
    projectRoot, tree, fbsId: 'FBS-001',
    themeMode: 'light-default-with-toggle',
    themeTokensModule: 'src/ui/tokens.ts',
    contrastTestPath: 'test/ui-contrast.test.ts',
    contrastTestAuthoredBeforePalette: true,
  });
  assert.equal(good?.kind, undefined);
});

test('missingDesignStageArtefacts flags all three sub-blocks when absent', () => {
  assert.deepEqual(missingDesignStageArtefacts({}), ['journeys', 'navModel', 'themeAndA11y']);
});

test('writeMarkComplete refuses when any artefact is missing', async () => {
  const { projectRoot } = await makeTempProject({ uiBearing: true, designStage: { journeys: [{ id: 'j', actor: 'a', goal: 'g', steps: ['s1', 's2'] }] } });
  const { tree } = await walkTree({ projectRoot });
  const result = await writeMarkComplete({ projectRoot, tree, fbsId: 'FBS-001' });
  assert.equal(result?.kind, 'usage');
  assert.match(result.message, /designStage is missing: navModel, themeAndA11y/);
});

test('writeMarkComplete refuses on baseline-vs-designStage disagreement without an opt-out', async () => {
  const { projectRoot } = await makeTempProject(
    {
      uiBearing: true,
      designStage: {
        journeys: [{ id: 'j', actor: 'a', goal: 'g', steps: ['s1', 's2'] }],
        navModel: { shape: 'shared-persistent', routes: [{ path: '/', label: 'Home', authRequired: true }] },
        themeAndA11y: { themeMode: 'dark-default-with-toggle', themeTokensModule: 'src/ui/tokens.ts', contrastTargets: 'WCAG AA', contrastTestPath: 'test/x.test.ts', contrastTestAuthoredBeforePalette: true },
      },
    },
    {
      uiBaseline: {
        id: 'uib-2026-07-30-001', createdAt: '2026-07-30T00:00:00Z', prdId: 'PRD-001',
        defaults: { themeMode: 'light-default-with-toggle' },
        operatorAckAt: '2026-07-30T00:00:00Z',
      },
    },
  );
  const { tree } = await walkTree({ projectRoot });
  const result = await writeMarkComplete({ projectRoot, tree, fbsId: 'FBS-001' });
  assert.equal(result?.kind, 'usage');
  assert.match(result.message, /themeMode/);
});

test('writeMarkComplete succeeds and sets designStageComplete=true when all artefacts are present and baseline agrees', async () => {
  const { projectRoot } = await makeTempProject(
    {
      uiBearing: true,
      designStage: {
        journeys: [{ id: 'j', actor: 'a', goal: 'g', steps: ['s1', 's2'] }],
        navModel: { shape: 'shared-persistent', routes: [{ path: '/', label: 'Home', authRequired: true }] },
        themeAndA11y: { themeMode: 'light-default-with-toggle', themeTokensModule: 'src/ui/tokens.ts', contrastTargets: 'WCAG AA', contrastTestPath: 'test/x.test.ts', contrastTestAuthoredBeforePalette: true },
      },
    },
    {
      uiBaseline: {
        id: 'uib-2026-07-30-001', createdAt: '2026-07-30T00:00:00Z', prdId: 'PRD-001',
        defaults: { themeMode: 'light-default-with-toggle' },
        operatorAckAt: '2026-07-30T00:00:00Z',
      },
    },
  );
  const { tree } = await walkTree({ projectRoot });
  const result = await writeMarkComplete({ projectRoot, tree, fbsId: 'FBS-001' });
  assert.equal(result?.ok, true);
  const written = JSON.parse(await readFile(join(projectRoot, 'rcf', 'fbs', 'fbs-001.json'), 'utf8'));
  assert.equal(written.designStageComplete, true);
});

test('firstBaselineDisagreement returns null when baseline and designStage line up on every paired field', () => {
  const tree = { manifest: { uiBaseline: { defaults: { themeMode: 'light-default-with-toggle' } } } };
  const fbs = { designStage: { themeAndA11y: { themeMode: 'light-default-with-toggle' } } };
  assert.equal(firstBaselineDisagreement(tree, fbs), null);
});
