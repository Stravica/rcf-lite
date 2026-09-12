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
  assert.equal(doc.version, '1.0.10');
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
// listed here must exist, its run wrapper must exist, and when the
// anatomy suite invokes each probe module in-memory the returned
// results[] rows must satisfy one of the four rule-7d shapes on every
// row. The anatomy test never reads .rcf/reports/ and never writes a
// report file; the probe invocation loop lives inside the test.

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

function aggregateOf(results) {
  if (!Array.isArray(results) || results.length === 0) return 'fail';
  if (results.some((r) => r && r.verdict === 'fail')) return 'fail';
  if (results.some((r) => r && r.verdict === 'warn')) return 'warn';
  return 'pass';
}

test('application-charts criterion-e probes aggregate to fail under each shipped fixture break (TC-criterion-e-negative-variants)', async () => {
  const probesDir = join(REPO_ROOT, 'blueprints', 'application-charts', 'contributions', 'probes');
  // Break switch -> probes that must aggregate fail when the fixture
  // is booted with that break as PROBE_BREAK. The mapping tracks each
  // shipped ?break switch on the fixture and names every probe whose
  // server-observable row detects the mutation.
  const brokenExpectations = [
    { brk: 'table', probes: ['text-alternative-table'] },
    { brk: 'pattern', probes: ['non-colour-distinction'] },
    { brk: 'keyboard', probes: ['keyboard-traversal'] },
  ];
  for (const { brk, probes: probeNames } of brokenExpectations) {
    for (const name of probeNames) {
      const prior = process.env.PROBE_BREAK;
      process.env.PROBE_BREAK = brk;
      try {
        const modUrl = pathToFileURL(join(probesDir, name + '.mjs')).href + '?nv=' + brk;
        const mod = await import(modUrl);
        const outcome = await mod.default();
        const results = (outcome && outcome.results) || [];
        const agg = aggregateOf(results);
        assert.equal(agg, 'fail', name + ' under PROBE_BREAK=' + brk + ' aggregated ' + agg + ' expected fail; verdicts=' + JSON.stringify(results.map((r) => r.verdict)));
      } finally {
        if (prior === undefined) delete process.env.PROBE_BREAK;
        else process.env.PROBE_BREAK = prior;
      }
    }
  }
});

test('application-charts criterion-e probes invoked in-memory carry rule-7d evidence rows (TC-criterion-e-evidence-shape)', async () => {
  const probesDir = join(REPO_ROOT, 'blueprints', 'application-charts', 'contributions', 'probes');
  const probeNames = ['non-colour-distinction', 'text-alternative-table', 'keyboard-traversal'];
  const validAnchorIds = await loadContributedAnchorIds(BLUEPRINT_ROOT, 'application-charts');
  for (const name of probeNames) {
    const mod = await import(pathToFileURL(join(probesDir, name + '.mjs')).href);
    const runProbe = mod.default;
    assert.equal(typeof runProbe, 'function', name + ': probe module must default-export a runProbe function');
    let outcome;
    try {
      outcome = await runProbe();
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      assert.fail(name + ': runProbe threw ' + message);
    }
    const results = outcome && Array.isArray(outcome.results) ? outcome.results : null;
    assert.ok(results && results.length > 0, name + ' returned no results[]');
    const failRow = results.find((r) => r && r.verdict === 'fail');
    assert.equal(failRow, undefined, name + ' has a fail-verdict row');
    for (const r of results) {
      assert.notEqual(r.anchorAcId, 'unknown', name + ' carries anchorAcId="unknown"');
      if (typeof r.anchorAcId === 'string' && r.anchorAcId.length > 0) {
        assert.ok(validAnchorIds.has(r.anchorAcId), name + ' anchorAcId=' + r.anchorAcId + ' is not a shipped AC or REQ id');
      }
      if (typeof r.notObservableAcId === 'string' && r.notObservableAcId.length > 0) {
        assert.ok(validAnchorIds.has(r.notObservableAcId), name + ' notObservableAcId=' + r.notObservableAcId + ' is not a shipped AC or REQ id');
      }
      assertRule7dRowShape(r, name);
    }
  }
});

// Rule-7d row-shape helper (extracted so the negative-case test can
// verify the check refuses an anchored conformanceOnly row without
// duplicating the shape logic). A valid row is exactly one of:
//   - conformanceOnly: null anchor + non-empty limitation;
//   - notObservableHere: non-empty anchorAcId + non-empty reason;
//   - accountBoundSkipped: non-empty reason;
//   - a positive-evidence row with a non-empty anchorAcId AND a
//     rule-7d evidence object made up of a non-empty engine-returned
//     requestId AND (a non-empty bodyExcerpt OR a non-empty derived
//     object). A positive row with only a request id, only an
//     excerpt, only an empty {derived:{}} or only an errorExcerpt is
//     rejected as under-shaped. Any row that carries
//     conformanceOnly=true with a non-null anchor is rejected even if
//     it happens to also carry an evidence field.
function assertRule7dRowShape(r, name) {
  const ev = r && r.evidence && typeof r.evidence === 'object' ? r.evidence : null;
  const hasRequestId = ev && typeof ev.requestId === 'string' && ev.requestId.length > 0;
  const hasBodyExcerpt = ev && typeof ev.bodyExcerpt === 'string' && ev.bodyExcerpt.length > 0;
  const hasDerived = ev && ev.derived && typeof ev.derived === 'object';
  const hasDerivedNonEmpty = hasDerived && Object.keys(ev.derived).length > 0;
  const hasEvidenceObject = ev && hasRequestId && (hasBodyExcerpt || hasDerivedNonEmpty);
  if (r.conformanceOnly === true) {
    const nullAnchor = r.anchorAcId === null || r.anchorAcId === undefined;
    assert.ok(nullAnchor && typeof r.limitation === 'string' && r.limitation.length > 0,
      name + ' conformanceOnly row anchorAcId=' + r.anchorAcId + ' violates the rule-7d null-anchor + limitation shape');
    return;
  }
  if (r.notObservableHere === true) {
    assert.ok(typeof r.reason === 'string' && r.reason.length > 0
      && typeof r.anchorAcId === 'string' && r.anchorAcId.length > 0,
      name + ' notObservableHere row violates the rule-7d anchor + reason shape');
    return;
  }
  if (r.accountBoundSkipped === true) {
    assert.ok(typeof r.reason === 'string' && r.reason.length > 0,
      name + ' accountBoundSkipped row is missing a reason field (rule 7d)');
    return;
  }
  assert.ok(typeof r.anchorAcId === 'string' && r.anchorAcId.length > 0,
    name + ' positive-evidence row has no anchorAcId (rule 7d)');
  assert.ok(hasEvidenceObject, name + ' positive-evidence row anchorAcId=' + r.anchorAcId + ' has no rule-7d evidence object');
}

test('rule-7d row-shape check refuses an anchored conformanceOnly row (TC-criterion-e-evidence-shape-negative)', async () => {
  const badRow = {
    anchorAcId: 'application-charts-AC-18103-1',
    conformanceOnly: true,
    limitation: 'a partial observation',
    verdict: 'warn',
    evidence: { requestId: 'r', bodyExcerpt: 'x', derived: {} },
  };
  assert.throws(() => assertRule7dRowShape(badRow, 'negative-case'),
    /conformanceOnly row anchorAcId=application-charts-AC-18103-1 violates the rule-7d null-anchor \+ limitation shape/);
});

test('rule-7d row-shape check refuses a positive row with an empty derived object and no excerpt (TC-criterion-e-evidence-shape-negative-empty-derived)', async () => {
  const badRow = {
    anchorAcId: 'application-charts-AC-18103-1',
    verdict: 'pass',
    detail: 'positive row with only an empty derived',
    evidence: { requestId: 'r', derived: {} },
  };
  assert.throws(() => assertRule7dRowShape(badRow, 'negative-case-empty-derived'),
    /positive-evidence row anchorAcId=application-charts-AC-18103-1 has no rule-7d evidence object/);
});

test('rule-7d row-shape check refuses a positive row with only a request id (TC-criterion-e-evidence-shape-negative-id-only)', async () => {
  const badRow = {
    anchorAcId: 'application-charts-AC-18103-1',
    verdict: 'pass',
    detail: 'positive row with only a request id',
    evidence: { requestId: 'r' },
  };
  assert.throws(() => assertRule7dRowShape(badRow, 'negative-case-id-only'),
    /positive-evidence row anchorAcId=application-charts-AC-18103-1 has no rule-7d evidence object/);
});
