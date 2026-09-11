// Anatomy + apply + probe-pack test for the application-file-upload
// v1.0.0 shelf blueprint (visual round 4 T-2, spec section 5.2).
//
// Covers TS-054.

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

import { startServer, TRANSPORTS, STATES, REFUSAL_REASONS } from '../fixtures/probe-pack-application-file-upload/server.js';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..', '..', '..');
const BLUEPRINT_ROOT = join(REPO_ROOT, 'blueprints', 'application-file-upload');
const PACK_ABS = join(BLUEPRINT_ROOT, 'probe-packs', 'application-file-upload.pack.mjs');
const README_ABS = join(BLUEPRINT_ROOT, 'README.md');
const CHANGELOG_ABS = join(BLUEPRINT_ROOT, 'CHANGELOG.md');
const TOPICS_ABS = join(BLUEPRINT_ROOT, 'docs', 'topics.md');
const GUIDE_ABS = join(BLUEPRINT_ROOT, 'guide', 'application-file-upload.md');
const PACK_SRC_ABS = PACK_ABS;

test('blueprint.json declares 20 contributions with no capabilities and no requiresAppliedCapabilities (TC-054-blueprint-json-shape)', async () => {
  const doc = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  assert.equal(doc.slug, 'application-file-upload');
  assert.equal(doc.version, '1.2.3');
  assert.equal(doc.category, 'application');
  assert.equal(doc.providesRoles, undefined, 'providesRoles absent (leaf blueprint per spec)');
  assert.deepEqual(doc.capabilities, ['virusScan'], 'capabilities declares virusScan (F-3 close, 1.2.0)');
  assert.equal(doc.requiresAppliedCapabilities, undefined, 'requiresAppliedCapabilities absent (no auth required)');
  assert.equal(doc.suggestedCompanions.length, 2);
  const roles = doc.suggestedCompanions.map((c) => c.role).sort();
  assert.deepEqual(roles, ['errorHandling', 'logging']);
  const reqs = doc.contributions.filter((c) => c.kind === 'req');
  const uss = doc.contributions.filter((c) => c.kind === 'us');
  const tacs = doc.contributions.filter((c) => c.kind === 'tac');
  const adrs = doc.contributions.filter((c) => c.kind === 'adr');
  assert.equal(reqs.length, 7, 'seven REQs');
  assert.equal(uss.length, 7, 'seven USs (one per REQ plus two cross-cutting)');
  assert.equal(tacs.length, 3, 'three TACs');
  assert.equal(adrs.length, 3, 'three ADRs');
  assert.equal(doc.contributions.length, 20, '20 contributions total');
  const adrIds = adrs.map((a) => a.id).sort();
  assert.deepEqual(adrIds, [
    'ADR-2401-application-file-upload-transport',
    'ADR-2402-application-file-upload-accepted-set',
    'ADR-2403-application-file-upload-virus-scan',
  ]);
  const adrClauses = adrs.map((a) => a.standardsTraceClause);
  assert.ok(adrClauses.every((c) => typeof c === 'string' && c.length > 0), 'every ADR contribution carries standardsTraceClause');
  // ADR-2401 is the recommendedDefault for the transport branch.
  const transportAdr = adrs.find((a) => a.id === 'ADR-2401-application-file-upload-transport');
  assert.equal(transportAdr.recommendedDefault, true, 'ADR-2401 carries recommendedDefault: true');
  assert.equal(transportAdr.elicited, true, 'ADR-2401 carries elicited: true');
});

test('applies cleanly on a fresh init project and adds 20 documents to the tree (TC-054-applies-clean)', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'file-upload-scratch-'));
  await initProject({ projectRoot: scratch, projectName: 'scratch' });
  const bp = await loadBlueprint(BLUEPRINT_ROOT);
  assert.equal(bp.slug, 'application-file-upload');
  const { tree } = await walkTree({ projectRoot: scratch });
  const result = await applyBlueprint({ projectRoot: scratch, tree, source: BLUEPRINT_ROOT });
  assert.equal(result.applied, true, JSON.stringify(result));
  assert.equal(result.slug, 'application-file-upload');
  const walked = await walkTree({ projectRoot: scratch });
  assert.deepEqual(walked.errors, []);
  const added = walked.tree.requirements.filter((r) => r.reqId.startsWith('application-file-upload-'));
  assert.equal(added.length, 7);
  const uss = walked.tree.userStories.filter((u) => u.usId.startsWith('application-file-upload-'));
  assert.equal(uss.length, 7);
});

test('every pack check id matches a contributed AC id and appliesTo binds tacIds AND route (TC-054-pack-checks-cross-check)', async () => {
  const acIds = await readContributedAcIds({ blueprintAbsPath: BLUEPRINT_ROOT });
  const packMod = await import(pathToFileURL(PACK_ABS).href);
  const validation = validatePackModule({ mod: packMod, blueprintSlug: 'application-file-upload', packAbsPath: PACK_ABS });
  assert.ok(validation.ok, JSON.stringify(validation.errors ?? []));
  const missing = validation.pack.checks.map((c) => c.id).filter((id) => !acIds.has(id));
  assert.deepEqual(missing, [], 'every pack check id must resolve to a contributed AC id');
  const expectedCheckIds = ['AC-23101-1', 'AC-23102-1', 'AC-23103-1', 'AC-23104-1'];
  const actual = validation.pack.checks.map((c) => c.id);
  assert.deepEqual(actual, expectedCheckIds, 'four pack checks anchored one per contract');
  const missingDescription = validation.pack.checks.filter((c) => typeof c.description !== 'string' || c.description.length === 0);
  assert.deepEqual(missingDescription, [], 'every pack check carries a non-empty description per spec section 9');
  // appliesTo references BOTH tacIds AND route (the two legal source-scan seams).
  const src = validation.pack.appliesTo.toString();
  assert.ok(/tacIds/.test(src), 'appliesTo references tacIds');
  assert.ok(/route|navModel|path/.test(src), 'appliesTo references route/navModel/path');
  // withUrl helper used, no bare string concatenation.
  const packText = await readFile(PACK_SRC_ABS, 'utf8');
  assert.ok(/function withUrl\(runtimeUrl, path\)/.test(packText), 'pack defines withUrl helper');
  const withUrlCalls = (packText.match(/withUrl\(runtimeUrl,/g) ?? []).length;
  assert.ok(withUrlCalls >= 4, `pack calls withUrl at least once per check (${withUrlCalls} calls)`);
  // No bare `runtimeUrl + '` concatenation.
  assert.ok(!/runtimeUrl\s*\+\s*['"`]/.test(packText), 'pack contains no bare runtimeUrl + string concatenation');
  // WCAG 2.5.7 keyword check (spec section 6 T-2 gate row).
  const keyboardHits = (packText.match(/keyboard/gi) ?? []).length;
  assert.ok(keyboardHits >= 1, `pack description references the keyboard alternative (WCAG 2.5.7) at least once; got ${keyboardHits}`);
});

test('application-file-upload: pack loader discovers the shipped pack against an applied scratch project (TC-054-pack-loader-discovers)', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'file-upload-loader-'));
  await initProject({ projectRoot: scratch, projectName: 'scratch' });
  const { tree } = await walkTree({ projectRoot: scratch });
  await applyBlueprint({ projectRoot: scratch, tree, source: BLUEPRINT_ROOT });
  const { packs, errors, warnings } = await loadProbePacks({
    appliedBlueprints: [{ slug: 'application-file-upload', absPath: BLUEPRINT_ROOT }],
    projectRoot: scratch,
  });
  assert.deepEqual(errors, [], JSON.stringify(errors));
  assert.deepEqual(warnings, []);
  assert.equal(packs.length, 1);
  assert.equal(packs[0].packName, 'application-file-upload');
  assert.equal(packs[0].checks.length, 4);
});

test('sample-app fixture serves both transport branches on the default branch (TC-054-fixture-serves-transports)', async () => {
  const { server, port } = await startServer({ port: 0 });
  try {
    assert.deepEqual(TRANSPORTS, ['multipart', 'tus'], 'fixture exports the two transport slugs in the ratified order');
    assert.deepEqual(STATES, ['idle', 'uploading', 'refused', 'complete'], 'fixture exports the four file-row state slugs in the ratified order');
    assert.deepEqual(REFUSAL_REASONS, ['mime-refused', 'size-refused', 'virus-refused'], 'fixture exports the closed refusal reason set');
    // The multipart branch renders the region carrying data-transport="multipart".
    const mpRes = await fetch(`http://127.0.0.1:${port}/upload?transport=multipart`);
    assert.equal(mpRes.status, 200);
    const mpHtml = await mpRes.text();
    assert.ok(mpHtml.includes('data-transport="multipart"'), 'multipart branch renders data-transport="multipart"');
    assert.ok(mpHtml.includes('data-surface="file-upload"'), 'multipart branch renders the upload region');
    assert.ok(/input[^>]*type="file"/.test(mpHtml), 'multipart branch renders a file input');
    assert.ok(mpHtml.includes('data-drop-zone'), 'multipart branch renders the drop-zone');
    assert.ok(mpHtml.includes('data-open-picker'), 'multipart branch renders the keyboard-focusable opener');
    assert.ok(mpHtml.includes('data-live-region="polite"'), 'multipart branch preseeds the polite live-region wrapper');
    assert.ok(mpHtml.includes('data-assertive-slot'), 'multipart branch preseeds the assertive slot');
    // The tus branch renders the region carrying data-transport="tus".
    const tusRes = await fetch(`http://127.0.0.1:${port}/upload?transport=tus`);
    assert.equal(tusRes.status, 200);
    const tusHtml = await tusRes.text();
    assert.ok(tusHtml.includes('data-transport="tus"'), 'tus branch renders data-transport="tus"');
    // The synthetic acknowledgement endpoints exist for both branches.
    const chunkRes = await fetch(`http://127.0.0.1:${port}/upload/chunk?n=1`, { method: 'POST' });
    assert.equal(chunkRes.status, 200, 'POST /upload/chunk returns 200');
    // AC-23104-3: the fixture now enforces the expected offset per tus.io semantics,
    // so a fresh upload starts at Upload-Offset: 0 and advances by the bytes actually
    // written; here 512 body bytes -> new offset 512.
    const tusPatch = await fetch(`http://127.0.0.1:${port}/upload/tus?uploadId=fixture-serves-transports`, {
      method: 'PATCH',
      headers: { 'Upload-Offset': '0' },
      body: 'x'.repeat(512),
    });
    assert.equal(tusPatch.status, 204, 'PATCH /upload/tus returns 204 after writing 512 body bytes at Upload-Offset 0');
    assert.equal(tusPatch.headers.get('upload-offset'), '512', 'PATCH /upload/tus echoes the advanced Upload-Offset');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('sample-app fixture break switches surface the four defects on the DOM (TC-054-negative-runs)', async () => {
  const { server, port } = await startServer({ port: 0 });
  try {
    // ?break=no-input drops the file input while keeping the drop-zone.
    const niHtml = await (await fetch(`http://127.0.0.1:${port}/upload?break=no-input`)).text();
    assert.ok(!/input[^>]*type="file"/.test(niHtml), 'no-input break switch drops the file input element');
    assert.ok(niHtml.includes('data-drop-zone'), 'no-input break switch keeps the drop-zone (so the pack sees the WCAG 2.5.7 gap)');
    // ?break=no-live-region drops the polite wrapper element (a CSS selector that names the attribute is unaffected; grep on the element start tag).
    const nlrHtml = await (await fetch(`http://127.0.0.1:${port}/upload?break=no-live-region`)).text();
    assert.ok(!/<div[^>]*data-live-region="polite"/.test(nlrHtml), 'no-live-region break switch drops the polite wrapper element');
    // ?seed=refused server-renders a refused row so a plain curl or fetch already sees the refused shape.
    const refHtml = await (await fetch(`http://127.0.0.1:${port}/upload?seed=refused`)).text();
    assert.ok(/data-file-row[^>]*data-refused="true"/.test(refHtml), 'refused row is present in server-rendered DOM');
    assert.ok(/data-refusal-reason="mime-refused"/.test(refHtml), 'refused row carries a closed refusal reason (mime-refused)');
    assert.ok(/aria-describedby="err-\d+"/.test(refHtml), 'refused row binds an aria-describedby to its error-message id');
    assert.ok(/data-error-message[^>]*id="err-\d+"/.test(refHtml), 'refused row error message carries the referenced id');
    assert.ok(/data-recovery="retry"/.test(refHtml), 'refused row exposes a [data-recovery="retry"] control');
    // ?break=no-chunks: the fixture serves the same shell; the collapse is client-side (JS forces one chunk). Prove the JS honours the switch via a substring grep on the embedded constant.
    const ncHtml = await (await fetch(`http://127.0.0.1:${port}/upload?break=no-chunks`)).text();
    assert.ok(ncHtml.includes('const BREAK = "no-chunks"'), 'no-chunks break switch propagates into the embedded client script');
    // ?break=send-refused: client sends the refused file to the server anyway.
    const srHtml = await (await fetch(`http://127.0.0.1:${port}/upload?break=send-refused&seed=refused`)).text();
    assert.ok(srHtml.includes('const BREAK = "send-refused"'), 'send-refused break switch propagates into the embedded client script');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('four state slugs and two transport slugs appear identically across README guide pack and docs (TC-054-state-and-transport-parity)', async () => {
  const readme = await readFile(README_ABS, 'utf8');
  const guide = await readFile(GUIDE_ABS, 'utf8');
  const topics = await readFile(TOPICS_ABS, 'utf8');
  const packText = await readFile(PACK_ABS, 'utf8');
  const states = ['idle', 'uploading', 'refused', 'complete'];
  for (const state of states) {
    assert.ok(readme.includes(state), `README names state "${state}"`);
    assert.ok(topics.includes(state), `docs/topics.md names state "${state}"`);
    assert.ok(guide.includes(state), `guide names state "${state}"`);
  }
  const transports = ['multipart', 'tus'];
  for (const transport of transports) {
    assert.ok(readme.includes(transport), `README names transport "${transport}"`);
    assert.ok(topics.includes(transport), `docs/topics.md names transport "${transport}"`);
    assert.ok(guide.includes(transport), `guide names transport "${transport}"`);
    assert.ok(packText.includes(transport), `pack names transport "${transport}"`);
  }
});

test('README lists mechanism-reach gaps and CHANGELOG carries 1.0.0 and topics carries the T-2 row (TC-054-readme-gaps-and-changelog)', async () => {
  const readme = await readFile(README_ABS, 'utf8');
  const changelog = await readFile(CHANGELOG_ABS, 'utf8');
  const topics = await readFile(TOPICS_ABS, 'utf8');
  // README lists Known mechanism-reach gaps section and one bullet per runtime-observable AC that is not directly bound.
  assert.ok(readme.includes('Known mechanism-reach gaps'), 'README carries the Known mechanism-reach gaps section');
  for (const acId of ['AC-23101-1', 'AC-23102-1', 'AC-23103-1', 'AC-23104-1', 'AC-23105-1', 'AC-23106-1', 'AC-23107-1']) {
    assert.ok(readme.includes(acId), `README names ${acId} in the mechanism-reach gaps section`);
  }
  // CHANGELOG has exactly one 1.0.0 entry.
  assert.match(changelog, /## 1\.0\.0/, 'CHANGELOG carries the 1.0.0 heading');
  // docs/topics.md carries the T-2 shelf registry row.
  assert.match(topics, /\| application-file-upload \| 23101-23899 \| 24xx \| shipped v1\.0\.0 \| none \|/, 'T-2 shelf registry row present in blueprint docs/topics.md');
});

test('application-file-upload: no em-dashes in shipped prose', async () => {
  const files = [README_ABS, CHANGELOG_ABS, GUIDE_ABS, TOPICS_ABS];
  for (const path of files) {
    const text = await readFile(path, 'utf8');
    assert.ok(!text.includes('—'), `${path} contains an em-dash (U+2014)`);
    assert.ok(!text.includes('–'), `${path} contains an en-dash (U+2013)`);
  }
});

// ---------------------------------------------------------------
// criterion-e probe pack pinning (2026-09-11)
// The pack lives at blueprints/application-file-upload/contributions/probes/ and
// exercises the local fixture at packages/rcf-lite/test/fixtures/
// probe-pack-application-file-upload/. Each probe records the fixture-echoed
// x-fixture-request-id header, status and a body excerpt as the
// positive evidence rule 7d requires.
// ---------------------------------------------------------------
import { readdir as _readdirCritE } from 'node:fs/promises';
import { pathToFileURL as _toUrlCritE } from 'node:url';
import { join as _joinCritE } from 'node:path';

const _CRIT_E_REPO_ROOT = REPO_ROOT;
const _CRIT_E_BP_ROOT = _joinCritE(_CRIT_E_REPO_ROOT, 'blueprints', 'application-file-upload');
const _CRIT_E_PROBES_DIR = _joinCritE(_CRIT_E_BP_ROOT, 'contributions', 'probes');
const _CRIT_E_FIXTURE_DIR = _joinCritE(_CRIT_E_REPO_ROOT, 'packages', 'rcf-lite', 'test', 'fixtures', 'probe-pack-application-file-upload');
const _CRIT_E_PROBE_NAMES = ["upload-surface-shape","per-file-progressbar","chunked-transport-endpoints","assertive-completion-slot"];

test('application-file-upload: criterion-e probes/ pack carries probe-utils and every named probe with its run-*.mjs wrapper (TC-crit-e-pack-shape)', async () => {
  const entries = await _readdirCritE(_CRIT_E_PROBES_DIR);
  assert.ok(entries.includes('probe-utils.mjs'), 'probe-utils.mjs must exist');
  for (const name of _CRIT_E_PROBE_NAMES) {
    assert.ok(entries.includes(name + '.mjs'), 'probe module ' + name + '.mjs missing');
    assert.ok(entries.includes('run-' + name + '.mjs'), 'probe shim run-' + name + '.mjs missing');
  }
});

test('application-file-upload: every criterion-e probe module exports an anchorReqId naming a contributed REQ and accountBound=false (TC-crit-e-anchors)', async () => {
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

test('application-file-upload: sample-app fixture README declares env vars for the probe pack (TC-crit-e-fixture-env-vars)', async () => {
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
        continue;
      }
      if (r && r.conformanceOnly === true) {
        assert.ok(typeof r.limitation === 'string' && r.limitation.length > 0,
          name + ' conformanceOnly row missing limitation: ' + JSON.stringify(r).slice(0, 200));
        // conformanceOnly rows still carry real evidence; fall through to the strict checks below.
      }
      
      if (r.evidence) {
        const ev = r.evidence;
        // Rule 7d addendum 3 (2026-09-11) rule 14: STRICT.
        // A row passes only with a non-empty request id AND a
        // non-empty body excerpt or a derived value; a bare
        // "reason" never counts and status zero never counts.
        // notObservableHere and accountBoundSkipped rows have
        // already been handled above.
        assert.ok(typeof ev.route === 'string' && ev.route.length > 0,
          name + ' evidence missing non-empty route: ' + JSON.stringify(ev).slice(0, 200));
        assert.ok(Number.isFinite(ev.status) && ev.status > 0,
          name + ' evidence status zero never counts: ' + JSON.stringify(ev).slice(0, 200));
        const hasRequestId = typeof ev.xFixtureRequestId === 'string' && ev.xFixtureRequestId.length > 0;
        assert.ok(hasRequestId,
          name + ' evidence missing non-empty request id: ' + JSON.stringify(ev).slice(0, 200));
        const hasBodyOrDerived = (typeof ev.bodyExcerpt === 'string' && ev.bodyExcerpt.length > 0)
          || (ev && typeof ev.derived === 'object' && ev.derived !== null)
          || (ev && typeof ev.derivedOutput === 'object' && ev.derivedOutput !== null);
        assert.ok(hasBodyOrDerived,
          name + ' evidence missing body excerpt or derived value: ' + JSON.stringify(ev).slice(0, 200));
      }
    }
  }
});
