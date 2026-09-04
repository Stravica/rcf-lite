// Anatomy + apply + probe-pack test for the application-charts
// v1.0.0 shelf blueprint (visual round T-2, spec section 5.2).
//
// Covers TS-048.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { applyBlueprint } from '../../src/blueprint/apply.js';
import { initProject } from '../../src/core/store/init.js';
import { walkTree } from '../../src/core/store/walker.js';
import { loadBlueprint } from '../../src/blueprint/loader.js';
import { loadProbePacks, readContributedAcIds } from '../../src/browser-verify/pack-loader.js';
import { validatePackModule } from '../../src/browser-verify/pack-schema.js';

import { startServer } from '../fixtures/probe-pack-application-charts/server.js';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..', '..', '..');
const BLUEPRINT_ROOT = join(REPO_ROOT, 'blueprints', 'application-charts');
const PACK_ABS = join(BLUEPRINT_ROOT, 'probe-packs', 'application-charts.pack.mjs');

test('application-charts: blueprint.json declares the ratified shape (TC-048-blueprint-json-shape)', async () => {
  const doc = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  assert.equal(doc.slug, 'application-charts');
  assert.equal(doc.version, '1.0.0');
  assert.equal(doc.category, 'application');
  assert.equal(doc.providesRoles, undefined);
  assert.equal(doc.suggestedCompanions.length, 2);
  const roles = doc.suggestedCompanions.map((c) => c.role).sort();
  assert.deepEqual(roles, ['errorHandling', 'logging']);
  const reqs = doc.contributions.filter((c) => c.kind === 'req');
  const uss = doc.contributions.filter((c) => c.kind === 'us');
  const tacs = doc.contributions.filter((c) => c.kind === 'tac');
  const adrs = doc.contributions.filter((c) => c.kind === 'adr');
  assert.equal(reqs.length, 4, 'four REQs');
  assert.equal(uss.length, 6, 'six USs');
  assert.equal(tacs.length, 2, 'two TACs');
  assert.equal(adrs.length, 3, 'three ADRs');
  assert.equal(doc.contributions.length, 15, '15 contributions total');
});

test('application-charts: applies cleanly on a fresh init project and adds 15 documents to the tree (TC-048-applies-clean)', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'charts-scratch-'));
  await initProject({ projectRoot: scratch, projectName: 'scratch' });
  const bp = await loadBlueprint(BLUEPRINT_ROOT);
  assert.equal(bp.slug, 'application-charts');
  const { tree } = await walkTree({ projectRoot: scratch });
  const result = await applyBlueprint({ projectRoot: scratch, tree, source: BLUEPRINT_ROOT });
  assert.equal(result.applied, true, JSON.stringify(result));
  assert.equal(result.slug, 'application-charts');
  const walked = await walkTree({ projectRoot: scratch });
  assert.deepEqual(walked.errors, []);
  const added = walked.tree.requirements.filter((r) => r.reqId.startsWith('application-charts-'));
  assert.equal(added.length, 4);
  const uss = walked.tree.userStories.filter((u) => u.usId.startsWith('application-charts-'));
  assert.equal(uss.length, 6);
});

test('application-charts: every AC id in each contributed US matches the pack check ids and every check carries a description (TC-048-pack-checks-cross-check)', async () => {
  const acIds = await readContributedAcIds({ blueprintAbsPath: BLUEPRINT_ROOT });
  const packMod = await import(pathToFileURL(PACK_ABS).href);
  const validation = validatePackModule({ mod: packMod, blueprintSlug: 'application-charts', packAbsPath: PACK_ABS });
  assert.ok(validation.ok, JSON.stringify(validation.errors ?? []));
  const missing = validation.pack.checks.map((c) => c.id).filter((id) => !acIds.has(id));
  assert.deepEqual(missing, []);
  const expectedCheckIds = ['AC-18102-1', 'AC-18103-1', 'AC-18104-1'];
  const actual = validation.pack.checks.map((c) => c.id);
  assert.deepEqual(actual, expectedCheckIds);
  const missingDescription = validation.pack.checks.filter((c) => typeof c.description !== 'string' || c.description.length === 0);
  assert.deepEqual(missingDescription, [], 'every pack check must carry a non-empty description per spec section 9');
});

test('application-charts: pack loader discovers the shipped pack against an applied scratch project (TC-048-pack-loader-discovers)', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'charts-loader-'));
  await initProject({ projectRoot: scratch, projectName: 'scratch' });
  const { tree } = await walkTree({ projectRoot: scratch });
  await applyBlueprint({ projectRoot: scratch, tree, source: BLUEPRINT_ROOT });
  const { packs, errors, warnings } = await loadProbePacks({
    appliedBlueprints: [{ slug: 'application-charts', absPath: BLUEPRINT_ROOT }],
    projectRoot: scratch,
  });
  assert.deepEqual(errors, [], JSON.stringify(errors));
  assert.deepEqual(warnings, []);
  assert.equal(packs.length, 1);
  assert.equal(packs[0].packName, 'application-charts');
  assert.equal(packs[0].checks.length, 3);
});

test('application-charts sample-app fixture: startServer renders the chart shell (TC-048-fixture-charts-render)', async () => {
  const { server, port } = await startServer({ port: 0 });
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('<svg class="chartSvg" data-chart-form="bar"'), 'bar chart SVG present');
    assert.ok(html.includes('<svg class="chartSvg" data-chart-form="line"'), 'line chart SVG present');
    assert.ok(html.includes('data-pattern="solid"'), 'series carries data-pattern cue');
    assert.ok(html.includes('data-pattern="hatched"'), 'series carries data-pattern cue for second series (bar)');
    assert.ok(html.includes('data-pattern="dashed"'), 'series carries data-pattern cue for second series (line)');
    assert.ok(html.match(/tabindex="0" aria-label="[^,]+, [^,]+, \d+ (requests|ms)"/), 'data points carry tabindex 0 and aria-label matching the announced format');
    assert.ok(html.includes('<table class="chartAltTable"'), 'paired text-alternative table present');
    assert.ok(html.includes('chartShowAltTable'), 'labelled show-table control present');
    assert.ok(html.includes('@media (prefers-reduced-motion: reduce)'), 'reduced-motion media rule present');
    const healthz = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(healthz.status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('application-charts sample-app fixture: break switches refuse ship on each surface (TC-048-negative-runs)', async () => {
  const { server, port } = await startServer({ port: 0 });
  try {
    const brkTable = await (await fetch(`http://127.0.0.1:${port}/?break=table`)).text();
    assert.ok(!brkTable.includes('<table class="chartAltTable"'), '?break=table drops the alt table from the DOM');
    assert.ok(!brkTable.includes('<button type="button" class="chartShowAltTable"'), '?break=table also drops the show-table control button element');

    const brkPattern = await (await fetch(`http://127.0.0.1:${port}/?break=pattern`)).text();
    assert.ok(!brkPattern.match(/data-pattern="/), '?break=pattern drops every data-pattern attribute');

    const brkKeyboard = await (await fetch(`http://127.0.0.1:${port}/?break=keyboard`)).text();
    assert.ok(!brkKeyboard.match(/class="chartDataPoint"[^>]*tabindex="0"/), '?break=keyboard drops tabindex 0 from every data point');
    assert.ok(!brkKeyboard.match(/class="chartDataPoint"[^>]*aria-label="/), '?break=keyboard drops aria-label from every data point');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
