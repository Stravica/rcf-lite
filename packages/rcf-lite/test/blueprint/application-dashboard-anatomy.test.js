// Anatomy + apply + probe-pack test for the application-dashboard
// v1.0.0 shelf blueprint (visual round T-3, spec section 5.3).
//
// Covers TS-049.

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

import { startServer } from '../fixtures/probe-pack-application-dashboard/server.js';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..', '..', '..');
const BLUEPRINT_ROOT = join(REPO_ROOT, 'blueprints', 'application-dashboard');
const PACK_ABS = join(BLUEPRINT_ROOT, 'probe-packs', 'application-dashboard.pack.mjs');
const GUIDANCE_ABS = join(BLUEPRINT_ROOT, 'assets', 'guidance', 'dashboard-design.md');

test('application-dashboard: blueprint.json declares the ratified shape (TC-049-blueprint-json-shape)', async () => {
  const doc = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  assert.equal(doc.slug, 'application-dashboard');
  assert.equal(doc.version, '1.0.0');
  assert.equal(doc.category, 'application');
  assert.equal(doc.providesRoles, undefined, 'providesRoles absent (leaf blueprint per spec; loader refuses empty array when set)');
  assert.equal(doc.suggestedCompanions.length, 2);
  const roles = doc.suggestedCompanions.map((c) => c.role).sort();
  assert.deepEqual(roles, ['errorHandling', 'logging']);
  const reqs = doc.contributions.filter((c) => c.kind === 'req');
  const uss = doc.contributions.filter((c) => c.kind === 'us');
  const tacs = doc.contributions.filter((c) => c.kind === 'tac');
  const adrs = doc.contributions.filter((c) => c.kind === 'adr');
  assert.equal(reqs.length, 5, 'five REQs');
  assert.equal(uss.length, 7, 'seven USs');
  assert.equal(tacs.length, 3, 'three TACs');
  assert.equal(adrs.length, 3, 'three ADRs');
  assert.equal(doc.contributions.length, 18, '18 contributions total');
});

test('application-dashboard: applies cleanly on a fresh init project and adds 18 documents to the tree (TC-049-applies-clean)', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'dashboard-scratch-'));
  await initProject({ projectRoot: scratch, projectName: 'scratch' });
  const bp = await loadBlueprint(BLUEPRINT_ROOT);
  assert.equal(bp.slug, 'application-dashboard');
  const { tree } = await walkTree({ projectRoot: scratch });
  const result = await applyBlueprint({ projectRoot: scratch, tree, source: BLUEPRINT_ROOT });
  assert.equal(result.applied, true, JSON.stringify(result));
  assert.equal(result.slug, 'application-dashboard');
  const walked = await walkTree({ projectRoot: scratch });
  assert.deepEqual(walked.errors, []);
  const added = walked.tree.requirements.filter((r) => r.reqId.startsWith('application-dashboard-'));
  assert.equal(added.length, 5);
  const uss = walked.tree.userStories.filter((u) => u.usId.startsWith('application-dashboard-'));
  assert.equal(uss.length, 7);
});

test('application-dashboard: packaged design-guidance asset carries eight sections and five https citations (TC-049-guidance-asset)', async () => {
  const guidance = await readFile(GUIDANCE_ABS, 'utf8');
  const sectionHeaders = guidance.match(/^## \d+\. /gm) || [];
  assert.equal(sectionHeaders.length, 8, `expected eight section-2 headings, got ${sectionHeaders.length}`);
  const httpsCitations = guidance.match(/https:\/\/\S+/g) || [];
  const uniqueHttps = new Set(httpsCitations.map((u) => u.replace(/[.,;)]+$/, '')));
  assert.ok(uniqueHttps.size >= 5, `expected at least 5 unique https citations, got ${uniqueHttps.size}: ${[...uniqueHttps].join(', ')}`);
  // Named source families all appear at least once.
  assert.ok(guidance.includes('nngroup.com'), 'NN/g cited');
  assert.ok(guidance.toLowerCase().includes('tufte'), 'Tufte cited');
  assert.ok(guidance.includes('design-system.service.gov.uk'), 'GOV.UK Design System cited');
  assert.ok(guidance.includes('WCAG22') || guidance.includes('wcag22') || guidance.includes('WCAG 2.2'), 'WCAG 2.2 cited');
  assert.ok(guidance.toLowerCase().includes('few') || guidance.toLowerCase().includes('information dashboard design'), 'Few cited');
});

test('application-dashboard: every pack check id matches a contributed AC id, every check carries a description, appliesTo binds tacIds (TC-049-pack-checks-cross-check)', async () => {
  const acIds = await readContributedAcIds({ blueprintAbsPath: BLUEPRINT_ROOT });
  const packMod = await import(pathToFileURL(PACK_ABS).href);
  const validation = validatePackModule({ mod: packMod, blueprintSlug: 'application-dashboard', packAbsPath: PACK_ABS });
  assert.ok(validation.ok, JSON.stringify(validation.errors ?? []));
  const missing = validation.pack.checks.map((c) => c.id).filter((id) => !acIds.has(id));
  assert.deepEqual(missing, []);
  const expectedCheckIds = ['AC-19102-1', 'AC-19104-1', 'AC-19103-1'];
  const actual = validation.pack.checks.map((c) => c.id);
  assert.deepEqual(actual, expectedCheckIds);
  const missingDescription = validation.pack.checks.filter((c) => typeof c.description !== 'string' || c.description.length === 0);
  assert.deepEqual(missingDescription, [], 'every pack check must carry a non-empty description per spec section 9');
  // appliesTo source references tacIds and/or route (the two source-scan seams the loader accepts).
  const src = validation.pack.appliesTo.toString();
  assert.ok(/tacIds/.test(src), 'appliesTo references tacIds');
});

test('application-dashboard: pack loader discovers the shipped pack against an applied scratch project (TC-049-pack-loader-discovers)', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'dashboard-loader-'));
  await initProject({ projectRoot: scratch, projectName: 'scratch' });
  const { tree } = await walkTree({ projectRoot: scratch });
  await applyBlueprint({ projectRoot: scratch, tree, source: BLUEPRINT_ROOT });
  const { packs, errors, warnings } = await loadProbePacks({
    appliedBlueprints: [{ slug: 'application-dashboard', absPath: BLUEPRINT_ROOT }],
    projectRoot: scratch,
  });
  assert.deepEqual(errors, [], JSON.stringify(errors));
  assert.deepEqual(warnings, []);
  assert.equal(packs.length, 1);
  assert.equal(packs[0].packName, 'application-dashboard');
  assert.equal(packs[0].checks.length, 3);
});

test('application-dashboard sample-app fixture: startServer renders the dashboard shell (TC-049-fixture-dashboard-render)', async () => {
  const { server, port } = await startServer({ port: 0 });
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('data-region="tile-row"'), 'tile-row region present');
    assert.ok(html.includes('data-region="chart-region"'), 'chart-region present');
    assert.ok(html.includes('data-region="filter-chrome"'), 'filter-chrome present');
    assert.ok(html.includes('data-region="timeframe-picker"'), 'timeframe-picker present');
    assert.ok(html.includes('data-region="export-handle"'), 'export-handle present');
    assert.ok(html.includes('data-tile-role="primary-kpi"'), 'primary KPI tile present');
    assert.ok(html.includes('data-kpi-kind="revenue"'), 'primary KPI kind is a valid enum value');
    assert.ok(html.match(/data-region="shell-root"[^>]*data-as-of="\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z"/), 'shell root carries ISO-8601 as-of');
    assert.ok(html.includes('data-auto-refresh="off"'), 'auto-refresh off by default');
    assert.ok(html.match(/data-preset="last-7-days"/), 'timeframe preset button present');
    assert.ok(html.includes('data-export-format="csv"'), 'export format entry present');
    const healthz = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(healthz.status, 200);
    const reqsRes = await fetch(`http://127.0.0.1:${port}/__requests`);
    assert.equal(reqsRes.status, 200);
    const reqs = await reqsRes.json();
    assert.ok(Array.isArray(reqs), '/__requests returns an array');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('application-dashboard sample-app fixture: state pinning drives the four states on the primary tile (TC-049-fixture-state-pinning)', async () => {
  const { server, port } = await startServer({ port: 0 });
  try {
    for (const state of ['loading', 'empty', 'error', 'populated']) {
      const res = await fetch(`http://127.0.0.1:${port}/?tile=primary&state=${state}`);
      assert.equal(res.status, 200);
      const html = await res.text();
      const primaryMatch = html.match(/data-tile-id="primary"[\s\S]{0,600}/);
      assert.ok(primaryMatch, `primary tile block found for ${state}`);
      const block = primaryMatch[0];
      assert.ok(block.includes(`data-tile-state="${state}"`), `state ${state} present on primary tile`);
      assert.ok(block.includes(`data-state-cue="${state}"`), `visual cue for ${state} present`);
      assert.ok(block.includes('aria-live="polite"'), `aria-live polite present for state ${state}`);
      assert.ok(block.includes('role="region"'), `role region present for state ${state}`);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('application-dashboard sample-app fixture: break switches refuse ship on each surface (TC-049-negative-runs)', async () => {
  const { server, port } = await startServer({ port: 0 });
  try {
    const brkKpi = await (await fetch(`http://127.0.0.1:${port}/?break=kpi-position`)).text();
    const firstTileMatch = brkKpi.match(/<article class="tile"[^>]*data-tile-id="([^"]+)"/);
    assert.ok(firstTileMatch, 'first tile matched');
    assert.notEqual(firstTileMatch[1], 'primary', '?break=kpi-position moves primary tile off first');

    const brkFanout = await (await fetch(`http://127.0.0.1:${port}/?break=fanout`)).text();
    // The break switch is expressed through the client-side fanOut function; the HTML embeds brk as JSON.
    assert.ok(brkFanout.includes('"fanout"'), '?break=fanout embedded in client script');

    const brkStateAria = await (await fetch(`http://127.0.0.1:${port}/?break=state-aria`)).text();
    // Assert against the primary-tile block only: the export handle listbox and the chart region carry their own role="region" markers.
    const primaryTileMatch = brkStateAria.match(/<article class="tile"[^>]*data-tile-id="primary"[\s\S]{0,700}?<\/article>/);
    assert.ok(primaryTileMatch, 'primary tile block matched under break=state-aria');
    const primaryTileBlock = primaryTileMatch[0];
    assert.ok(!primaryTileBlock.includes('role="region"'), '?break=state-aria drops role="region" from tile wrappers');
    assert.ok(!primaryTileBlock.includes('aria-live="polite"'), '?break=state-aria drops aria-live polite from tile wrappers');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
