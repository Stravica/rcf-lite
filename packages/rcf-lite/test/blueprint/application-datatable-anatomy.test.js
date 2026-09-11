// Anatomy + apply + probe-pack test for the application-datatable
// v1.0.0 shelf blueprint (visual round T-1, spec section 5.1).
//
// Covers TS-047.

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

import { startServer } from '../fixtures/probe-pack-application-datatable/server.js';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..', '..', '..');
const BLUEPRINT_ROOT = join(REPO_ROOT, 'blueprints', 'application-datatable');
const PACK_ABS = join(BLUEPRINT_ROOT, 'probe-packs', 'application-datatable.pack.mjs');

test('application-datatable: blueprint.json declares the ratified shape (TC-047-blueprint-json-shape)', async () => {
  const doc = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  assert.equal(doc.slug, 'application-datatable');
  assert.equal(doc.version, '1.0.6');
  assert.equal(doc.category, 'application');
  assert.equal(doc.providesRoles, undefined);
  assert.equal(doc.suggestedCompanions.length, 2);
  const roles = doc.suggestedCompanions.map((c) => c.role).sort();
  assert.deepEqual(roles, ['errorHandling', 'logging']);
  const reqs = doc.contributions.filter((c) => c.kind === 'req');
  const uss = doc.contributions.filter((c) => c.kind === 'us');
  const tacs = doc.contributions.filter((c) => c.kind === 'tac');
  const adrs = doc.contributions.filter((c) => c.kind === 'adr');
  assert.equal(reqs.length, 6, 'six REQs');
  assert.equal(uss.length, 9, 'nine USs');
  assert.equal(tacs.length, 3, 'three TACs');
  assert.equal(adrs.length, 4, 'four ADRs');
  assert.equal(doc.contributions.length, 22, '22 contributions total');
});

test('application-datatable: applies cleanly on a fresh init project and adds 22 documents to the tree (TC-047-applies-clean)', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'datatable-scratch-'));
  await initProject({ projectRoot: scratch, projectName: 'scratch' });
  const bp = await loadBlueprint(BLUEPRINT_ROOT);
  assert.equal(bp.slug, 'application-datatable');
  const { tree } = await walkTree({ projectRoot: scratch });
  const result = await applyBlueprint({ projectRoot: scratch, tree, source: BLUEPRINT_ROOT });
  assert.equal(result.applied, true, JSON.stringify(result));
  assert.equal(result.slug, 'application-datatable');
  const walked = await walkTree({ projectRoot: scratch });
  assert.deepEqual(walked.errors, []);
  const added = walked.tree.requirements.filter((r) => r.reqId.startsWith('application-datatable-'));
  assert.equal(added.length, 6);
  const uss = walked.tree.userStories.filter((u) => u.usId.startsWith('application-datatable-'));
  assert.equal(uss.length, 9);
});

test('application-datatable: every AC id in each contributed US matches the pack check ids and vice versa where anchored (TC-047-pack-checks-cross-check)', async () => {
  const acIds = await readContributedAcIds({ blueprintAbsPath: BLUEPRINT_ROOT });
  const packMod = await import(pathToFileURL(PACK_ABS).href);
  const validation = validatePackModule({ mod: packMod, blueprintSlug: 'application-datatable', packAbsPath: PACK_ABS });
  assert.ok(validation.ok, JSON.stringify(validation.errors ?? []));
  const missing = validation.pack.checks.map((c) => c.id).filter((id) => !acIds.has(id));
  assert.deepEqual(missing, []);
  const expectedCheckIds = ['AC-17101-1', 'AC-17102-1', 'AC-17103-2', 'AC-17104-3', 'AC-17105-1', 'AC-17106-1'];
  const actual = validation.pack.checks.map((c) => c.id);
  assert.deepEqual(actual, expectedCheckIds);
});

test('application-datatable: pack loader discovers the shipped pack against an applied scratch project (TC-047-pack-loader-discovers)', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'datatable-loader-'));
  await initProject({ projectRoot: scratch, projectName: 'scratch' });
  const { tree } = await walkTree({ projectRoot: scratch });
  await applyBlueprint({ projectRoot: scratch, tree, source: BLUEPRINT_ROOT });
  const { packs, errors, warnings } = await loadProbePacks({
    appliedBlueprints: [{ slug: 'application-datatable', absPath: BLUEPRINT_ROOT }],
    projectRoot: scratch,
  });
  assert.deepEqual(errors, [], JSON.stringify(errors));
  assert.deepEqual(warnings, []);
  assert.equal(packs.length, 1);
  assert.equal(packs[0].packName, 'application-datatable');
  assert.equal(packs[0].checks.length, 6);
});

test('application-datatable sample-app fixture: startServer returns rows on /api/rows with sort, q, page and pageSize (TC-047-fixture-api-rows)', async () => {
  const { server, port } = await startServer({ port: 0 });
  try {
    const baseRes = await fetch(`http://127.0.0.1:${port}/api/rows`);
    const base = await baseRes.json();
    assert.equal(base.page, 1);
    assert.equal(base.pageSize, 3);
    assert.equal(base.total, 8);
    assert.equal(base.rows.length, 3);
    const sortedRes = await fetch(`http://127.0.0.1:${port}/api/rows?sort=score:asc`);
    const sorted = await sortedRes.json();
    const sortedIds = sorted.rows.map((r) => r.id);
    // score asc across the whole set is [2 (10), 6 (15), 3 (20), ...]; page 1 gets the first three
    assert.deepEqual(sortedIds, [2, 6, 3]);
    const filteredRes = await fetch(`http://127.0.0.1:${port}/api/rows?q=Alpha`);
    const filtered = await filteredRes.json();
    assert.equal(filtered.q, 'Alpha');
    assert.equal(filtered.total, 1);
    assert.equal(filtered.rows[0].name, 'Alpha');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// ---------------------------------------------------------------
// criterion-e probe pack pinning (2026-09-11)
// The pack lives at blueprints/application-datatable/contributions/probes/ and
// exercises the local fixture at packages/rcf-lite/test/fixtures/
// probe-pack-application-datatable/. Each probe records the fixture-echoed
// x-fixture-request-id header, status and a body excerpt as the
// positive evidence rule 7d requires.
// ---------------------------------------------------------------
import { readdir as _readdirCritE } from 'node:fs/promises';
import { pathToFileURL as _toUrlCritE } from 'node:url';
import { join as _joinCritE } from 'node:path';

const _CRIT_E_REPO_ROOT = REPO_ROOT;
const _CRIT_E_BP_ROOT = _joinCritE(_CRIT_E_REPO_ROOT, 'blueprints', 'application-datatable');
const _CRIT_E_PROBES_DIR = _joinCritE(_CRIT_E_BP_ROOT, 'contributions', 'probes');
const _CRIT_E_FIXTURE_DIR = _joinCritE(_CRIT_E_REPO_ROOT, 'packages', 'rcf-lite', 'test', 'fixtures', 'probe-pack-application-datatable');
const _CRIT_E_PROBE_NAMES = ["apg-table-shape","search-adapter-round-trip","sort-adapter-round-trip","four-states-regions"];

test('application-datatable: criterion-e probes/ pack carries probe-utils and every named probe with its run-*.mjs wrapper (TC-crit-e-pack-shape)', async () => {
  const entries = await _readdirCritE(_CRIT_E_PROBES_DIR);
  assert.ok(entries.includes('probe-utils.mjs'), 'probe-utils.mjs must exist');
  for (const name of _CRIT_E_PROBE_NAMES) {
    assert.ok(entries.includes(name + '.mjs'), 'probe module ' + name + '.mjs missing');
    assert.ok(entries.includes('run-' + name + '.mjs'), 'probe shim run-' + name + '.mjs missing');
  }
});

test('application-datatable: every criterion-e probe module exports an anchorReqId naming a contributed REQ and accountBound=false (TC-crit-e-anchors)', async () => {
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

test('application-datatable: sample-app fixture README declares env vars for the probe pack (TC-crit-e-fixture-env-vars)', async () => {
  const { readFile: _rf, stat: _st } = await import('node:fs/promises');
  await _st(_joinCritE(_CRIT_E_FIXTURE_DIR, 'server.js'));
  const readme = await _rf(_joinCritE(_CRIT_E_FIXTURE_DIR, 'README.md'), 'utf8');
  assert.match(readme, /## Declared env vars/);
  assert.match(readme, /PROBE_PORT/);
  assert.match(readme, /47300-47399/);
});

test('every criterion-e probe result carries one of the four 7d evidence shapes (TC-crit-e-evidence-shape)', async () => {
  for (const name of _CRIT_E_PROBE_NAMES) {
    const mod = await import(_toUrlCritE(_joinCritE(_CRIT_E_PROBES_DIR, name + '.mjs')).href);
    const { results } = await mod.default();
    assert.ok(Array.isArray(results) && results.length > 0, name + ' returned no results');
    for (const r of results) {
      const shaped = (r && typeof r.evidence === 'object' && r.evidence)
        || r.accountBoundSkipped === true;
      assert.ok(shaped, name + ' result ' + JSON.stringify(r).slice(0, 200) + ' missing evidence or accountBoundSkipped');
      if (r.evidence) {
        const ev = r.evidence;
        // Rule 7d addendum (external review 2026-09-11): every real
        // evidence row carries a route, a status and either a
        // fixture-stamped request id or a named fallback reason.
        assert.ok(typeof ev.route === 'string' && ev.route.length > 0,
          name + ' evidence missing non-empty route: ' + JSON.stringify(ev).slice(0, 200));
        assert.ok(Number.isFinite(ev.status) && ev.status >= 0,
          name + ' evidence missing numeric status: ' + JSON.stringify(ev).slice(0, 200));
        const hasRequestId = typeof ev.xFixtureRequestId === 'string' && ev.xFixtureRequestId.length > 0;
        const namedFallback = typeof ev.reason === 'string' && ev.reason.length > 0;
        assert.ok(hasRequestId || namedFallback,
          name + ' evidence has no requestId, body excerpt or status: ' + JSON.stringify(ev).slice(0, 200));
      }
    }
  }
});
