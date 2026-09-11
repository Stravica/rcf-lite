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
  assert.equal(doc.version, '1.0.7');
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

// Criterion-e (positive-evidence) probe pack pins. The pack lives at
// blueprints/application-charts/contributions/probes/. Every probe file
// listed here must exist, its run wrapper must exist, and (when the
// probe has already been executed against the fixture) its run
// record in .rcf/reports/ must carry an evidence object of one of
// the four rule-7d shapes on every result row.

test('application-charts contributions/probes/ pack files exist (TC-criterion-e-pack-shape)', async () => {
  const contribRoot = join(REPO_ROOT, 'blueprints', 'application-charts', 'contributions', 'probes');
  const utilsPath = join(contribRoot, 'probe-utils.mjs');
  await readFile(utilsPath, 'utf8'); // throws if missing
  const probes = ['non-colour-distinction', 'text-alternative-table', 'keyboard-traversal'];
  const runners = ['run-non-colour-distinction', 'run-text-alternative-table', 'run-keyboard-traversal'];
  for (const name of probes) await readFile(join(contribRoot, name + '.mjs'), 'utf8');
  for (const name of runners) await readFile(join(contribRoot, name + '.mjs'), 'utf8');
});

// Family-local helper: enumerate the valid anchor-id set from the
// blueprint's shipped user stories and requirements. Every AC id in
// contributions/user-stories/*.json is prefixed with the slug to form
// a slug-prefixed anchor id, matching the shape probes emit. Kept
// inline (not on the shared _probe-anatomy-helpers.mjs) so the mixed
// branch's helper owner is undisturbed.
async function loadContributedAnchorIds(blueprintRoot, slug) {
  const { readdir, readFile: rf } = await import('node:fs/promises');
  const ids = new Set();
  async function collect(subdir) {
    const dir = join(blueprintRoot, 'contributions', subdir);
    let files = [];
    try { files = (await readdir(dir)).filter((f) => f.endsWith('.json')); } catch (_) { return; }
    for (const f of files) {
      const doc = JSON.parse(await rf(join(dir, f), 'utf8'));
      if (Array.isArray(doc.acceptanceCriteria)) {
        for (const ac of doc.acceptanceCriteria) if (typeof ac.id === 'string' && ac.id.length > 0) ids.add(slug + '-' + ac.id);
      }
      if (typeof doc.reqId === 'string' && doc.reqId.length > 0) ids.add(doc.reqId);
    }
  }
  await collect('user-stories');
  await collect('requirements');
  return ids;
}

test('application-charts criterion-e run records carry rule-7d evidence when present (TC-criterion-e-evidence-shape)', async () => {
  const reportsDir = join(REPO_ROOT, '.rcf', 'reports', 'blueprints', 'application-charts');
  const validAnchorIds = await loadContributedAnchorIds(BLUEPRINT_ROOT, 'application-charts');
  let entries = [];
  try {
    const { readdir } = await import('node:fs/promises');
    entries = await readdir(reportsDir);
  } catch (_) {
    // Reports must exist for this check to mean anything (the
    // run-record inspection rule: the check runner reads the
    // records; so do you). A missing reports directory is a fail:
    // run 'pnpm test:blueprint-probes' or 'node blueprints/application-charts/contributions/probes/run-*.mjs'
    // before the anatomy suite.
    assert.fail('reports directory absent: ' + reportsDir + ' - run the probes first');
  }
  const jsonEntries = entries.filter((f) => f.endsWith('.json'));
  assert.ok(jsonEntries.length > 0, 'no report files in ' + reportsDir);
  for (const filename of jsonEntries) {
    const raw = await readFile(join(reportsDir, filename), 'utf8');
    const doc = JSON.parse(raw);
    assert.ok(Array.isArray(doc.results) && doc.results.length > 0, filename + ' has no results');
    assert.notEqual(doc.aggregateVerdict, 'fail', filename + ' aggregateVerdict=fail');
    for (const r of doc.results) {
      // The anchor is either a real AC/REQ id string or null (a
      // conformance-only or exception-fallback row). The literal
      // string "unknown" is refused; ANY non-null anchor MUST exist
      // in the blueprint's shipped user stories / requirements.
      assert.notEqual(r.anchorAcId, 'unknown', filename + ' carries anchorAcId="unknown"');
      if (typeof r.anchorAcId === 'string' && r.anchorAcId.length > 0) {
        assert.ok(validAnchorIds.has(r.anchorAcId), filename + ' anchorAcId=' + r.anchorAcId + ' is not a shipped AC or REQ id');
      }
      if (typeof r.notObservableAcId === 'string' && r.notObservableAcId.length > 0) {
        assert.ok(validAnchorIds.has(r.notObservableAcId), filename + ' notObservableAcId=' + r.notObservableAcId + ' is not a shipped AC or REQ id');
      }
      const ev = r.evidence && typeof r.evidence === 'object' ? r.evidence : null;
      const hasRequestId = ev && typeof ev.requestId === 'string' && ev.requestId.length > 0;
      const hasBodyExcerpt = ev && typeof ev.bodyExcerpt === 'string' && ev.bodyExcerpt.length > 0;
      const hasDerived = ev && ev.derived && typeof ev.derived === 'object';
      const hasErrorExcerpt = ev && typeof ev.errorExcerpt === 'string' && ev.errorExcerpt.length > 0;
      const hasEvidenceObject = ev && (hasRequestId || hasBodyExcerpt || hasDerived || hasErrorExcerpt);
      const isHonestSkip = r.accountBoundSkipped === true && typeof r.reason === 'string' && r.reason.length > 0;
      const isNotObservableHere = r.notObservableHere === true
        && typeof r.reason === 'string' && r.reason.length > 0
        && typeof r.anchorAcId === 'string' && r.anchorAcId.length > 0;
      const isConformanceOnly = r.conformanceOnly === true
        && (r.anchorAcId === null || r.anchorAcId === undefined)
        && typeof r.limitation === 'string' && r.limitation.length > 0;
      assert.ok(hasEvidenceObject || isHonestSkip || isNotObservableHere || isConformanceOnly, filename + ' result ' + (r.anchorAcId || '(no anchor)') + ' has no rule-7d evidence object, no honest skip, no notObservableHere and no conformanceOnly');
    }
  }
});
