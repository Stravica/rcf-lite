// Anatomy + apply test for the application-error-handling v1.0.9
// shelf blueprint (core-companions train, spec section 1.2).
//
// Covers TS-039.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyBlueprint } from '../../src/blueprint/apply.js';
import { initProject } from '../../src/core/store/init.js';
import { walkTree } from '../../src/core/store/walker.js';
import { loadBlueprint } from '../../src/blueprint/loader.js';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..', '..', '..');
const BLUEPRINT_ROOT = join(REPO_ROOT, 'blueprints', 'application-error-handling');

test('application-error-handling: blueprint.json declares the ratified shape (TC-039-blueprint-json-fields)', async () => {
 const doc = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
 assert.equal(doc.slug, 'application-error-handling');
 assert.equal(doc.version, '1.0.9');
 assert.equal(doc.category, 'application');
 assert.deepEqual(doc.providesRoles, ['errorHandling']);
 assert.equal(doc.suggestedCompanions.length, 1);
 assert.equal(doc.suggestedCompanions[0].role, 'logging');
 const globalAdrs = doc.contributions.filter((c) => c.kind === 'adr' && c.scope === 'global');
 assert.equal(globalAdrs.length, 1);
 assert.equal(globalAdrs[0].id, 'ADR-1701-application-error-handling-record-shape');
 assert.equal(globalAdrs[0].topic, 'errorHandling');
 const reqIds = doc.contributions.filter((c) => c.kind === 'req').map((c) => c.id).sort();
 assert.deepEqual(reqIds, [
 'application-error-handling-REQ-001',
 'application-error-handling-REQ-002',
 'application-error-handling-REQ-003',
 'application-error-handling-REQ-004',
 ]);
 const tacIds = doc.contributions.filter((c) => c.kind === 'tac').map((c) => c.id).sort();
 assert.deepEqual(tacIds, [
 'TAC-1701-application-error-handling-boundary',
 'TAC-1702-application-error-handling-record-factory',
 ]);
});

test('application-error-handling: apply into a fresh fixture succeeds and writes the namespaced contributions (TC-039-clean-apply)', async () => {
 const root = await mkdtemp(join(tmpdir(), 'rcf-err-apply-'));
 await initProject({ projectRoot: root, projectName: 'err-apply' });
 const { tree } = await walkTree({ projectRoot: root });
 const res = await applyBlueprint({ projectRoot: root, tree, source: BLUEPRINT_ROOT });
 assert.equal(res.applied, true, JSON.stringify(res));
 assert.equal(res.slug, 'application-error-handling');
 const adrPath = join(root, 'rcf', 'adrs', 'adr-1701-application-error-handling-record-shape.json');
 const st = await stat(adrPath);
 assert.ok(st.isFile());
});

test('application-error-handling: docs/topics.md distinguishes errorHandling from errorEnvelope (TC-039-topics-distinct)', async () => {
 const topics = await readFile(join(BLUEPRINT_ROOT, 'docs', 'topics.md'), 'utf8');
 assert.match(topics, /`errorHandling`/);
 assert.match(topics, /errorEnvelope/);
 assert.match(topics, /Distinction from/);
 assert.match(topics, /16101-16899/);
 assert.match(topics, /17xx/);
});

// ---------------------------------------------------------------
// the pack probe pack pinning (2026-09-11)
// The pack lives at blueprints/application-error-handling/contributions/probes/ and
// exercises the local fixture at packages/rcf-lite/test/fixtures/
// probe-pack-application-error-handling/. Each probe records the fixture-echoed
// x-fixture-request-id header, status and a body excerpt as the
// positive evidence rule 7d requires.
// ---------------------------------------------------------------
import { readdir as _readdirCritE, readFile as _rf } from 'node:fs/promises';
import { pathToFileURL as _toUrlCritE } from 'node:url';
import { join as _joinCritE } from 'node:path';

const _CRIT_E_REPO_ROOT = REPO_ROOT;
const _CRIT_E_BP_ROOT = _joinCritE(_CRIT_E_REPO_ROOT, 'blueprints', 'application-error-handling');
const _CRIT_E_PROBES_DIR = _joinCritE(_CRIT_E_BP_ROOT, 'contributions', 'probes');
const _CRIT_E_FIXTURE_DIR = _joinCritE(_CRIT_E_REPO_ROOT, 'packages', 'rcf-lite', 'test', 'fixtures', 'probe-pack-application-error-handling');
const _CRIT_E_PROBE_NAMES = ["two-boundaries-registered","record-shape-adr-1701","category-vocabulary"];

test('application-error-handling: the pack probes/ pack carries probe-utils and every named probe with its run-*.mjs wrapper (TC-crit-e-pack-shape)', async () => {
 const entries = await _readdirCritE(_CRIT_E_PROBES_DIR);
 assert.ok(entries.includes('probe-utils.mjs'), 'probe-utils.mjs must exist');
 for (const name of _CRIT_E_PROBE_NAMES) {
 assert.ok(entries.includes(name + '.mjs'), 'probe module ' + name + '.mjs missing');
 assert.ok(entries.includes('run-' + name + '.mjs'), 'probe shim run-' + name + '.mjs missing');
 }
});

test('application-error-handling: every the pack probe module exports an anchorReqId naming a contributed REQ and accountBound=false (TC-crit-e-anchors)', async () => {
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

test('application-error-handling: sample-app fixture README declares env vars for the probe pack (TC-crit-e-fixture-env-vars)', async () => {
 const { readFile: _rf, stat: _st } = await import('node:fs/promises');
 await _st(_joinCritE(_CRIT_E_FIXTURE_DIR, 'server.js'));
 const readme = await _rf(_joinCritE(_CRIT_E_FIXTURE_DIR, 'README.md'), 'utf8');
 assert.match(readme, /## Declared env vars/);
 assert.match(readme, /PROBE_PORT/);
 assert.match(readme, /47300-47399/);
});

test('every the pack probe result carries one of the four 7d evidence shapes (TC-crit-e-evidence-shape)', async () => {
 const _usDir = _joinCritE(_CRIT_E_BP_ROOT, 'contributions', 'user-stories');
 const _acIds = new Set();
 for (const f of (await _readdirCritE(_usDir)).filter((n) => n.endsWith('.json'))) {
 const d = JSON.parse(await _rf(_joinCritE(_usDir, f), 'utf8'));
 for (const ac of (d.acceptanceCriteria || [])) {
 if (ac && typeof ac.id === 'string') {
 // Compose blueprint-prefixed AC id from the shipped slug.
 _acIds.add('application-error-handling-' + ac.id);
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
