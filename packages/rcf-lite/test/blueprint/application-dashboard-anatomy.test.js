// Anatomy + apply + probe-pack test for the application-dashboard v1.0.8 shelf blueprint (visual round T-3, spec section 5.3).
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
  assert.equal(doc.version, '1.0.8');
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

// ---------------------------------------------------------------
// criterion-e probe pack pinning (2026-09-11)
// The pack lives at blueprints/application-dashboard/contributions/probes/ and
// exercises the local fixture at packages/rcf-lite/test/fixtures/
// probe-pack-application-dashboard/. Each probe records the fixture-echoed
// x-fixture-request-id header, status and a body excerpt as the
// positive evidence rule 7d requires.
// ---------------------------------------------------------------
import { readdir as _readdirCritE, readFile as _rf } from 'node:fs/promises';
import { pathToFileURL as _toUrlCritE } from 'node:url';
import { join as _joinCritE } from 'node:path';

const _CRIT_E_REPO_ROOT = REPO_ROOT;
const _CRIT_E_BP_ROOT = _joinCritE(_CRIT_E_REPO_ROOT, 'blueprints', 'application-dashboard');
const _CRIT_E_PROBES_DIR = _joinCritE(_CRIT_E_BP_ROOT, 'contributions', 'probes');
const _CRIT_E_FIXTURE_DIR = _joinCritE(_CRIT_E_REPO_ROOT, 'packages', 'rcf-lite', 'test', 'fixtures', 'probe-pack-application-dashboard');
const _CRIT_E_PROBE_NAMES = ["shell-five-regions","primary-kpi-top-left","four-tile-states","export-handle-formats"];

test('application-dashboard: criterion-e probes/ pack carries probe-utils and every named probe with its run-*.mjs wrapper (TC-crit-e-pack-shape)', async () => {
  const entries = await _readdirCritE(_CRIT_E_PROBES_DIR);
  assert.ok(entries.includes('probe-utils.mjs'), 'probe-utils.mjs must exist');
  for (const name of _CRIT_E_PROBE_NAMES) {
    assert.ok(entries.includes(name + '.mjs'), 'probe module ' + name + '.mjs missing');
    assert.ok(entries.includes('run-' + name + '.mjs'), 'probe shim run-' + name + '.mjs missing');
  }
});

test('application-dashboard: every criterion-e probe module exports an anchorReqId naming a contributed REQ and accountBound=false (TC-crit-e-anchors)', async () => {
  const reqDir = _joinCritE(_CRIT_E_BP_ROOT, 'contributions', 'requirements');
  const { readFile: _rf } = await import('node:fs/promises');
  const reqFiles = (await _readdirCritE(reqDir)).filter((f) => f.endsWith('.json'));
  const reqIds = new Set();
  for (const f of reqFiles) {
    const d = JSON.parse(await _rf(_joinCritE(reqDir, f), 'utf8'));
    if (d.reqId) reqIds.add(d.reqId);
  }
  for (const name of _CRIT_E_PROBE_NAMES) {
    const mod = await import(_toUrlCritE(_joinCritE(_CRIT_E_PROBES_DIR, name + '.mjs')).href);
    assert.equal(typeof mod.anchorReqId, 'string', name + ' must export anchorReqId');
    assert.ok(reqIds.has(mod.anchorReqId), name + ' anchorReqId ' + mod.anchorReqId + ' not in contributed REQs');
    assert.equal(mod.accountBound, false, name + ' accountBound must be false for local fixture engine');
  }
});

test('application-dashboard: sample-app fixture README declares env vars for the probe pack (TC-crit-e-fixture-env-vars)', async () => {
  const { readFile: _rf, stat: _st } = await import('node:fs/promises');
  await _st(_joinCritE(_CRIT_E_FIXTURE_DIR, 'server.js'));
  const readme = await _rf(_joinCritE(_CRIT_E_FIXTURE_DIR, 'README.md'), 'utf8');
  assert.match(readme, /## Declared env vars/);
  assert.match(readme, /PROBE_PORT/);
  assert.match(readme, /47300-47399/);
});

test('every criterion-e probe result carries one of the four 7d evidence shapes (TC-crit-e-evidence-shape)', async () => {
  const _usDir = _joinCritE(_CRIT_E_BP_ROOT, 'contributions', 'user-stories');
  const _acIds = new Set();
  for (const f of (await _readdirCritE(_usDir)).filter((n) => n.endsWith('.json'))) {
    const d = JSON.parse(await _rf(_joinCritE(_usDir, f), 'utf8'));
    for (const ac of (d.acceptanceCriteria || [])) {
      if (ac && typeof ac.id === 'string') {
        // Compose blueprint-prefixed AC id from the shipped slug.
        _acIds.add('application-dashboard-' + ac.id);
      }
    }
  }
  const _reqDir = _joinCritE(_CRIT_E_BP_ROOT, 'contributions', 'requirements');
  const _reqIds = new Set();
  for (const f of (await _readdirCritE(_reqDir)).filter((n) => n.endsWith('.json'))) {
    const d = JSON.parse(await _rf(_joinCritE(_reqDir, f), 'utf8'));
    if (d.reqId) _reqIds.add(d.reqId);
  }
  for (const name of _CRIT_E_PROBE_NAMES) {
    const mod = await import(_toUrlCritE(_joinCritE(_CRIT_E_PROBES_DIR, name + '.mjs')).href);
    const { results } = await mod.default();
    assert.ok(Array.isArray(results) && results.length > 0, name + ' returned no results');
    for (const r of results) {
      const shaped = (r && typeof r.evidence === 'object' && r.evidence)
        || r.accountBoundSkipped === true
        || (r && typeof r.notObservableHere === 'object' && r.notObservableHere !== null);
      assert.ok(shaped, name + ' result ' + JSON.stringify(r).slice(0, 200) + ' missing evidence or accountBoundSkipped');
      if (r.accountBoundSkipped === true) {
        assert.ok(typeof r.reason === 'string' && r.reason.length > 0,
          name + ' account-bound skip missing named reason: ' + JSON.stringify(r).slice(0, 200));
        continue;
      }
      if (r && typeof r.notObservableHere === 'object' && r.notObservableHere !== null) {
        assert.ok(typeof r.notObservableHere.ac === 'string' && r.notObservableHere.ac.length > 0,
          name + ' notObservableHere row missing .ac id: ' + JSON.stringify(r).slice(0, 200));
        assert.ok(typeof r.notObservableHere.reason === 'string' && r.notObservableHere.reason.length > 0,
          name + ' notObservableHere row missing .reason: ' + JSON.stringify(r).slice(0, 200));
        assert.ok(_acIds.has(r.notObservableHere.ac),
          name + ' notObservableHere.ac ' + r.notObservableHere.ac + ' is not a shipped AC on this blueprint');
        continue;
      }
      if (r && r.conformanceOnly === true) {
        assert.ok(typeof r.limitation === 'string' && r.limitation.length > 0,
          name + ' conformanceOnly row missing limitation: ' + JSON.stringify(r).slice(0, 200));
      }
      if (r && typeof r.anchorAcId === 'string' && r.anchorAcId.length > 0) {
        assert.ok(_acIds.has(r.anchorAcId),
          name + ' anchorAcId ' + r.anchorAcId + ' is not a shipped AC on this blueprint');
      }
      if (r && typeof r.anchorReqId === 'string' && r.anchorReqId.length > 0) {
        assert.ok(_reqIds.has(r.anchorReqId),
          name + ' anchorReqId ' + r.anchorReqId + ' is not a shipped REQ on this blueprint');
      }
      if (r.evidence) {
        const ev = r.evidence;
        assert.ok(typeof ev.route === 'string' && ev.route.length > 0,
          name + ' evidence missing non-empty route: ' + JSON.stringify(ev).slice(0, 200));
        assert.ok(Number.isFinite(ev.status) && ev.status > 0,
          name + ' evidence status zero never counts: ' + JSON.stringify(ev).slice(0, 200));
        const hasRequestId = typeof ev.xFixtureRequestId === 'string' && ev.xFixtureRequestId.length > 0;
        assert.ok(hasRequestId,
          name + ' evidence missing non-empty request id: ' + JSON.stringify(ev).slice(0, 200));
        const derivedIsPopulated = (ev && typeof ev.derived === 'object' && ev.derived !== null && Object.keys(ev.derived).length > 0)
          || (ev && typeof ev.derivedOutput === 'object' && ev.derivedOutput !== null && Object.keys(ev.derivedOutput).length > 0);
        const hasBodyExcerpt = typeof ev.bodyExcerpt === 'string' && ev.bodyExcerpt.length > 0;
        assert.ok(hasBodyExcerpt || derivedIsPopulated,
          name + ' evidence missing body excerpt or non-empty derived value: ' + JSON.stringify(ev).slice(0, 200));
      }
    }
  }
});
