// Anatomy + probe-pack test for the application-api-rest v2.1.10
// shelf blueprint. Pins the the pack contributions/probes pack
// shape (four probes, matching run-*.mjs wrappers, probe-utils
// helper).
//
// Each probe runs against the local fixture at
// packages/rcf-lite/test/fixtures/probe-pack-application-api-rest/
// and records the x-request-id echo, status and a body excerpt as
// the positive evidence rule 7d requires.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..', '..', '..');
const BLUEPRINT_ROOT = join(REPO_ROOT, 'blueprints', 'application-api-rest');
const PROBES_DIR = join(BLUEPRINT_ROOT, 'contributions', 'probes');
const FIXTURE_DIR = join(REPO_ROOT, 'packages', 'rcf-lite', 'test', 'fixtures', 'probe-pack-application-api-rest');

const PROBE_NAMES = [
 'cursor-pagination-round-trip',
 'health-probes-distinct',
 'problem-details-on-error',
 'request-id-echoed',
];

test('application-api-rest: blueprint.json declares the shipped shape', async () => {
 const doc = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
 assert.equal(doc.slug, 'application-api-rest');
 assert.equal(doc.category, 'application');
 assert.equal(doc.version, '2.1.10');
});

test('application-api-rest: contributions/probes carries probe-utils and every named probe with its run-*.mjs wrapper', async () => {
 const entries = await readdir(PROBES_DIR);
 assert.ok(entries.includes('probe-utils.mjs'), 'probe-utils.mjs must exist');
 for (const name of PROBE_NAMES) {
 assert.ok(entries.includes(`${name}.mjs`), `probe module ${name}.mjs missing`);
 assert.ok(entries.includes(`run-${name}.mjs`), `probe shim run-${name}.mjs missing`);
 }
});

test('application-api-rest: every probe module exports an anchorReqId that names an application-api-rest REQ', async () => {
 const reqDir = join(BLUEPRINT_ROOT, 'contributions', 'requirements');
 const reqFiles = (await readdir(reqDir)).filter((f) => f.endsWith('.json'));
 const reqIds = new Set();
 for (const f of reqFiles) {
 const d = JSON.parse(await readFile(join(reqDir, f), 'utf8'));
 if (d.reqId) reqIds.add(d.reqId);
 }
 for (const name of PROBE_NAMES) {
 const mod = await import(pathToFileURL(join(PROBES_DIR, `${name}.mjs`)).href);
 assert.equal(typeof mod.anchorReqId, 'string', `${name} must export anchorReqId`);
 assert.ok(reqIds.has(mod.anchorReqId), `${name} anchorReqId ${mod.anchorReqId} not in contributed REQs`);
 assert.equal(mod.accountBound, false, `${name} accountBound must be false for local fixture engine`);
 }
});

test('application-api-rest: sample-app fixture carries a Declared env vars section', async () => {
 await stat(join(FIXTURE_DIR, 'server.js'));
 const readme = await readFile(join(FIXTURE_DIR, 'README.md'), 'utf8');
 assert.match(readme, /## Declared env vars/);
 assert.match(readme, /PROBE_PORT/);
 assert.match(readme, /47300-47399/);
});

test('application-api-rest: every probe result carries one of the four 7d evidence shapes (TC-crit-e-evidence-shape)', async () => {
 const usDir = join(BLUEPRINT_ROOT, 'contributions', 'user-stories');
 const acIds = new Set();
 for (const f of (await readdir(usDir)).filter((n) => n.endsWith('.json'))) {
 const d = JSON.parse(await readFile(join(usDir, f), 'utf8'));
 for (const ac of (d.acceptanceCriteria || [])) {
 if (ac && typeof ac.id === 'string') {
 // ac.id looks like "AC-1101-1"; the shipped ac id includes the slug prefix
 acIds.add('application-api-rest-' + ac.id);
 }
 }
 }
 const reqDir = join(BLUEPRINT_ROOT, 'contributions', 'requirements');
 const reqIds = new Set();
 for (const f of (await readdir(reqDir)).filter((n) => n.endsWith('.json'))) {
 const d = JSON.parse(await readFile(join(reqDir, f), 'utf8'));
 if (d.reqId) reqIds.add(d.reqId);
 }
 for (const name of PROBE_NAMES) {
 const mod = await import(pathToFileURL(join(PROBES_DIR, `${name}.mjs`)).href);
 const { results } = await mod.default();
 assert.ok(Array.isArray(results) && results.length > 0, `${name} returned no results`);
 for (const r of results) {
 const shaped = (r && typeof r.evidence === 'object' && r.evidence)
 || r.accountBoundSkipped === true
 || (r && typeof r.notObservableHere === 'object' && r.notObservableHere !== null);
 assert.ok(shaped, `${name} result missing evidence or accountBoundSkipped: ${JSON.stringify(r).slice(0, 200)}`);
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
 // the browser-only rule: the notObservableHere.ac must be a shipped AC id.
 assert.ok(acIds.has(r.notObservableHere.ac),
 name + ' notObservableHere.ac ' + r.notObservableHere.ac + ' is not a shipped AC on this blueprint');
 continue;
 }
 if (r && r.conformanceOnly === true) {
 assert.ok(typeof r.limitation === 'string' && r.limitation.length > 0,
 name + ' conformanceOnly row missing limitation: ' + JSON.stringify(r).slice(0, 200));
 }
 // anchorAcId (when present) resolves to a shipped AC.
 if (r && typeof r.anchorAcId === 'string' && r.anchorAcId.length > 0) {
 assert.ok(acIds.has(r.anchorAcId),
 name + ' anchorAcId ' + r.anchorAcId + ' is not a shipped AC on this blueprint');
 }
 // anchorReqId (when present) resolves to a shipped REQ.
 if (r && typeof r.anchorReqId === 'string' && r.anchorReqId.length > 0) {
 assert.ok(reqIds.has(r.anchorReqId),
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
 // "derived" must be a non-empty object; {} never counts as a derived value.
 const derivedIsPopulated = (ev && typeof ev.derived === 'object' && ev.derived !== null && Object.keys(ev.derived).length > 0)
 || (ev && typeof ev.derivedOutput === 'object' && ev.derivedOutput !== null && Object.keys(ev.derivedOutput).length > 0);
 const hasBodyExcerpt = typeof ev.bodyExcerpt === 'string' && ev.bodyExcerpt.length > 0;
 assert.ok(hasBodyExcerpt || derivedIsPopulated,
 name + ' evidence missing body excerpt or non-empty derived value: ' + JSON.stringify(ev).slice(0, 200));
 }
 }
 }
});
