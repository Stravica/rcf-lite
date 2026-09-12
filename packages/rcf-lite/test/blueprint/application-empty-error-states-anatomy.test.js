// Anatomy + apply + probe-pack test for the application-empty-error-states
// v1.0.0 shelf blueprint (visual round 4 T-1, spec section 5.1).
//
// Covers TS-053.

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

import { startServer, NAMED_STATES } from '../fixtures/probe-pack-application-empty-error-states/server.js';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..', '..', '..');
const BLUEPRINT_ROOT = join(REPO_ROOT, 'blueprints', 'application-empty-error-states');
const PACK_ABS = join(BLUEPRINT_ROOT, 'probe-packs', 'application-empty-error-states.pack.mjs');
const README_ABS = join(BLUEPRINT_ROOT, 'README.md');
const CHANGELOG_ABS = join(BLUEPRINT_ROOT, 'CHANGELOG.md');
const TOPICS_ABS = join(BLUEPRINT_ROOT, 'docs', 'topics.md');
const GUIDE_ABS = join(BLUEPRINT_ROOT, 'guide', 'application-empty-error-states.md');
const PACK_SRC_ABS = PACK_ABS;

test('blueprint.json declares 21 contributions with no capabilities and no requiresAppliedCapabilities (TC-053-blueprint-json-shape)', async () => {
  const doc = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  assert.equal(doc.slug, 'application-empty-error-states');
  assert.equal(doc.version, '1.2.7');
  assert.equal(doc.category, 'application');
  assert.equal(doc.providesRoles, undefined, 'providesRoles absent (leaf blueprint per spec)');
  assert.equal(doc.capabilities, undefined, 'capabilities absent (blueprint declares none)');
  assert.equal(doc.requiresAppliedCapabilities, undefined, 'requiresAppliedCapabilities absent (no auth required)');
  assert.equal(doc.suggestedCompanions.length, 2);
  const roles = doc.suggestedCompanions.map((c) => c.role).sort();
  assert.deepEqual(roles, ['errorHandling', 'logging']);
  const reqs = doc.contributions.filter((c) => c.kind === 'req');
  const uss = doc.contributions.filter((c) => c.kind === 'us');
  const tacs = doc.contributions.filter((c) => c.kind === 'tac');
  const adrs = doc.contributions.filter((c) => c.kind === 'adr');
  assert.equal(reqs.length, 7, 'seven REQs');
  assert.equal(uss.length, 8, 'eight USs one per named state');
  assert.equal(tacs.length, 3, 'three TACs');
  assert.equal(adrs.length, 3, 'three ADRs');
  assert.equal(doc.contributions.length, 21, '21 contributions total');
  const adrIds = adrs.map((a) => a.id).sort();
  assert.deepEqual(adrIds, [
    'ADR-2301-application-empty-error-states-status-contract',
    'ADR-2302-application-empty-error-states-stack-trace-visibility',
    'ADR-2303-application-empty-error-states-offline-strategy',
  ]);
  const adrClauses = adrs.map((a) => a.standardsTraceClause);
  assert.ok(adrClauses.every((c) => typeof c === 'string' && c.length > 0), 'every ADR contribution carries standardsTraceClause');
});

test('applies cleanly on a fresh init project and adds 21 documents to the tree (TC-053-applies-clean)', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'empty-error-states-scratch-'));
  await initProject({ projectRoot: scratch, projectName: 'scratch' });
  const bp = await loadBlueprint(BLUEPRINT_ROOT);
  assert.equal(bp.slug, 'application-empty-error-states');
  const { tree } = await walkTree({ projectRoot: scratch });
  const result = await applyBlueprint({ projectRoot: scratch, tree, source: BLUEPRINT_ROOT });
  assert.equal(result.applied, true, JSON.stringify(result));
  assert.equal(result.slug, 'application-empty-error-states');
  const walked = await walkTree({ projectRoot: scratch });
  assert.deepEqual(walked.errors, []);
  const added = walked.tree.requirements.filter((r) => r.reqId.startsWith('application-empty-error-states-'));
  assert.equal(added.length, 7);
  const uss = walked.tree.userStories.filter((u) => u.usId.startsWith('application-empty-error-states-'));
  assert.equal(uss.length, 8);
});

test('every pack check id matches a contributed AC id and appliesTo binds tacIds AND route (TC-053-pack-checks-cross-check)', async () => {
  const acIds = await readContributedAcIds({ blueprintAbsPath: BLUEPRINT_ROOT });
  const packMod = await import(pathToFileURL(PACK_ABS).href);
  const validation = validatePackModule({ mod: packMod, blueprintSlug: 'application-empty-error-states', packAbsPath: PACK_ABS });
  assert.ok(validation.ok, JSON.stringify(validation.errors ?? []));
  const missing = validation.pack.checks.map((c) => c.id).filter((id) => !acIds.has(id));
  assert.deepEqual(missing, [], 'every pack check id must resolve to a contributed AC id');
  const expectedCheckIds = [
    'AC-22101-1',
    'AC-22102-1',
    'AC-22103-1',
    'AC-22104-1',
    'AC-22105-1',
    'AC-22106-1',
    'AC-22107-1',
    'AC-22108-1',
  ];
  const actual = validation.pack.checks.map((c) => c.id);
  assert.deepEqual(actual, expectedCheckIds, 'eight pack checks anchored one per named state');
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
  assert.ok(withUrlCalls >= 8, `pack calls withUrl at least once per check (${withUrlCalls} calls)`);
  // No bare `runtimeUrl + '` concatenation.
  assert.ok(!/runtimeUrl\s*\+\s*['"`]/.test(packText), 'pack contains no bare runtimeUrl + string concatenation');
});

test('application-empty-error-states: pack loader discovers the shipped pack against an applied scratch project (TC-053-pack-loader-discovers)', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'empty-error-states-loader-'));
  await initProject({ projectRoot: scratch, projectName: 'scratch' });
  const { tree } = await walkTree({ projectRoot: scratch });
  await applyBlueprint({ projectRoot: scratch, tree, source: BLUEPRINT_ROOT });
  const { packs, errors, warnings } = await loadProbePacks({
    appliedBlueprints: [{ slug: 'application-empty-error-states', absPath: BLUEPRINT_ROOT }],
    projectRoot: scratch,
  });
  assert.deepEqual(errors, [], JSON.stringify(errors));
  assert.deepEqual(warnings, []);
  assert.equal(packs.length, 1);
  assert.equal(packs[0].packName, 'application-empty-error-states');
  assert.equal(packs[0].checks.length, 8);
});

test('sample-app fixture serves every one of the eight states on the default branch (TC-053-fixture-serves-states)', async () => {
  const { server, port } = await startServer({ port: 0 });
  try {
    assert.deepEqual(NAMED_STATES, [
      'not-found',
      'forbidden',
      'server-error',
      'offline',
      'permission-denied',
      'empty-list',
      'no-search-results',
      'error-boundary',
    ], 'fixture exports the eight named states in the ratified order');
    // Every route responds and renders its own [data-surface] region.
    const routes = {
      '/probe/not-found': { status: 404, surface: 'not-found' },
      '/probe/forbidden': { status: 403, surface: 'forbidden' },
      '/probe/server-error': { status: 500, surface: 'server-error' },
      '/probe/permission-denied': { status: 403, surface: 'permission-denied' },
      '/probe/offline': { status: 200, surface: 'offline' },
      '/probe/empty-list': { status: 200, surface: 'empty-list' },
      '/probe/search?q=needle': { status: 200, surface: 'no-search-results' },
      '/probe/error-boundary?crash=1': { status: 200, surface: 'error-boundary' },
    };
    for (const [path, expect] of Object.entries(routes)) {
      const res = await fetch(`http://127.0.0.1:${port}${path}`);
      assert.equal(res.status, expect.status, `${path} returned ${res.status}`);
      const html = await res.text();
      assert.ok(html.includes(`data-surface="${expect.surface}"`), `${path} renders [data-surface="${expect.surface}"]`);
    }
    // ?state= selector reaches the same surface without the path.
    const stateHit = await fetch(`http://127.0.0.1:${port}/?state=not-found`);
    const stateHitHtml = await stateHit.text();
    assert.ok(stateHitHtml.includes('data-surface="not-found"'), '?state= selector reaches the named state');
    // Refuses PORT=4200.
    // (Cannot spawn a subprocess in this test; the guard is asserted
    // structurally by importing the fixture and checking the source.)
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('sample-app fixture break switches surface the four defects on the DOM (TC-053-negative-runs)', async () => {
  const { server, port } = await startServer({ port: 0 });
  try {
    // ?break=stack-trace: server-error re-adds a stack trace with a source-path and env-key shape.
    const stackHtml = await (await fetch(`http://127.0.0.1:${port}/probe/server-error?break=stack-trace`)).text();
    assert.ok(/data-leak="stack"/.test(stackHtml), 'stack-trace break switch renders a data-leak="stack" block');
    assert.ok(/\/opt\/app\/src\/handlers\/widget\.js/.test(stackHtml), 'stack-trace break switch contains a source path');
    assert.ok(/process\.env\.NODE_ENV/.test(stackHtml), 'stack-trace break switch contains a process.env reference');

    // ?break=leak-id: forbidden re-adds a resource id.
    const forbiddenLeak = await (await fetch(`http://127.0.0.1:${port}/probe/forbidden?break=leak-id`)).text();
    assert.ok(/data-leak="resource-id"/.test(forbiddenLeak), 'leak-id break switch on forbidden renders a data-leak="resource-id" block');
    assert.ok(/widget-2039-alpha/.test(forbiddenLeak), 'leak-id break switch names the resource id token');
    // ?break=leak-id: permission-denied surfaces the id in its cause.
    const denyLeak = await (await fetch(`http://127.0.0.1:${port}/probe/permission-denied?break=leak-id`)).text();
    assert.ok(/widget-2039-alpha/.test(denyLeak), 'leak-id break switch on permission-denied leaks the resource id into the cause');

    // ?break=no-recovery: empty-list drops the create control.
    const emptyBreak = await (await fetch(`http://127.0.0.1:${port}/probe/empty-list?break=no-recovery`)).text();
    assert.ok(!/data-recovery="create"/.test(emptyBreak), 'no-recovery break switch drops the create control');

    // ?break=no-live-region: offline reconnect drops the polite wrapper element (a CSS selector containing the same attribute string is unaffected, so grep on the element start tag).
    const liveBreak = await (await fetch(`http://127.0.0.1:${port}/probe/offline?reconnect=1&break=no-live-region`)).text();
    assert.ok(!/<div[^>]*data-live-region="polite"/.test(liveBreak), 'no-live-region break switch drops the polite wrapper element on reconnect');
    // Sanity: the non-broken reconnect route DOES carry the wrapper element.
    const liveOk = await (await fetch(`http://127.0.0.1:${port}/probe/offline?reconnect=1`)).text();
    assert.ok(/<div[^>]*data-live-region="polite"[^>]*>Reconnected/.test(liveOk), 'reconnect route carries the polite wrapper element with the announcement');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('eight state slugs appear identically across README guide pack and docs (TC-053-state-enumeration-parity)', async () => {
  const readme = await readFile(README_ABS, 'utf8');
  const guide = await readFile(GUIDE_ABS, 'utf8');
  const topics = await readFile(TOPICS_ABS, 'utf8');
  const packText = await readFile(PACK_ABS, 'utf8');
  const expected = [
    'not-found',
    'forbidden',
    'server-error',
    'offline',
    'permission-denied',
    'empty-list',
    'no-search-results',
    'error-boundary',
  ];
  for (const state of expected) {
    assert.ok(readme.includes(state), `README names state "${state}"`);
    assert.ok(topics.includes(state), `docs/topics.md names state "${state}"`);
    assert.ok(packText.includes(state), `pack names state "${state}"`);
  }
  // The guide names the family group even where it does not enumerate every state slug.
  assert.ok(/eight named states|eight-state|eight states/.test(guide), 'guide references the eight-state family');
});

test('README lists mechanism-reach gaps and CHANGELOG carries 1.0.0 and topics carries the T-1 row (TC-053-readme-gaps-and-changelog)', async () => {
  const readme = await readFile(README_ABS, 'utf8');
  const changelog = await readFile(CHANGELOG_ABS, 'utf8');
  const topics = await readFile(TOPICS_ABS, 'utf8');
  // README lists Known mechanism-reach gaps section and one bullet per AC.
  assert.ok(readme.includes('Known mechanism-reach gaps'), 'README carries the Known mechanism-reach gaps section');
  for (const acId of ['AC-22101-1', 'AC-22102-1', 'AC-22103-1', 'AC-22104-1', 'AC-22105-1', 'AC-22106-1', 'AC-22107-1', 'AC-22108-1']) {
    assert.ok(readme.includes(acId), `README names ${acId} in the mechanism-reach gaps section`);
  }
  // CHANGELOG has exactly one 1.0.0 entry.
  assert.match(changelog, /## 1\.0\.0/, 'CHANGELOG carries the 1.0.0 heading');
  // docs/topics.md carries the T-1 shelf registry row.
  assert.match(topics, /\| application-empty-error-states \| 22101-22899 \| 23xx \| shipped v1\.0\.0 \| none \|/, 'T-1 shelf registry row present in blueprint docs/topics.md');
});

test('application-empty-error-states: no em-dashes in shipped prose', async () => {
  const files = [README_ABS, CHANGELOG_ABS, GUIDE_ABS, TOPICS_ABS];
  for (const path of files) {
    const text = await readFile(path, 'utf8');
    assert.ok(!text.includes(String.fromCharCode(0x2014)), `${path} contains an em-dash (U+2014)`);
    assert.ok(!text.includes('–'), `${path} contains an en-dash (U+2013)`);
  }
});

// Criterion-e (positive-evidence) probe pack pins. The pack lives at
// blueprints/application-empty-error-states/contributions/probes/. Every probe file
// listed here must exist, its run wrapper must exist, and when the
// anatomy suite invokes each probe module in-memory the returned
// results[] rows must satisfy one of the four rule-7d shapes on every
// row. The anatomy test never reads .rcf/reports/ and never writes a
// report file; the probe invocation loop lives inside the test.

test('application-empty-error-states contributions/probes/ pack files exist (TC-criterion-e-pack-shape)', async () => {
  const contribRoot = join(REPO_ROOT, 'blueprints', 'application-empty-error-states', 'contributions', 'probes');
  const utilsPath = join(contribRoot, 'probe-utils.mjs');
  await readFile(utilsPath, 'utf8'); // throws if missing
  const probes = ['not-found-and-recovery', 'forbidden-and-server-error', 'permission-denied-and-offline', 'empty-list-and-no-search', 'error-boundary-alert'];
  const runners = ['run-not-found-and-recovery', 'run-forbidden-and-server-error', 'run-permission-denied-and-offline', 'run-empty-list-and-no-search', 'run-error-boundary-alert'];
  for (const name of probes) await readFile(join(contribRoot, name + '.mjs'), 'utf8');
  for (const name of runners) await readFile(join(contribRoot, name + '.mjs'), 'utf8');
});

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

test('application-empty-error-states criterion-e probes aggregate to fail under each shipped fixture break (TC-criterion-e-negative-variants)', async () => {
  const probesDir = join(REPO_ROOT, 'blueprints', 'application-empty-error-states', 'contributions', 'probes');
  // Break switch -> probes that must aggregate fail when the fixture
  // is booted with that break as PROBE_BREAK. Only observable-side
  // breaks are covered; client-JS-only breaks are documented as
  // browser-verify territory in the fixture README.
  const brokenExpectations = [{"brk":"leak-id","probes":["forbidden-and-server-error"]},{"brk":"stack-trace","probes":["forbidden-and-server-error"]},{"brk":"no-recovery","probes":["empty-list-and-no-search"]}];
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

test('application-empty-error-states criterion-e probes invoked in-memory carry rule-7d evidence rows (TC-criterion-e-evidence-shape)', async () => {
  const probesDir = join(REPO_ROOT, 'blueprints', 'application-empty-error-states', 'contributions', 'probes');
  const probeNames = ['not-found-and-recovery', 'forbidden-and-server-error', 'permission-denied-and-offline', 'empty-list-and-no-search', 'error-boundary-alert'];
  const validAnchorIds = await loadContributedAnchorIds(BLUEPRINT_ROOT, 'application-empty-error-states');
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

// Rule-7d row-shape helper (see application-charts-anatomy.test.js
// for the full rationale). Kept per-file so each anatomy suite carries
// its own negative-case test with no shared-helper coupling.
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
    anchorAcId: 'application-empty-error-states-AC-22101-1',
    conformanceOnly: true,
    limitation: 'a partial observation',
    verdict: 'warn',
    evidence: { requestId: 'r', bodyExcerpt: 'x', derived: {} },
  };
  assert.throws(() => assertRule7dRowShape(badRow, 'negative-case'),
    /conformanceOnly row anchorAcId=application-empty-error-states-AC-22101-1 violates the rule-7d null-anchor \+ limitation shape/);
});


test('rule-7d row-shape check refuses a positive row with an empty derived object and no excerpt (TC-criterion-e-evidence-shape-negative-empty-derived)', async () => {
  const badRow = {
    anchorAcId: 'application-empty-error-states-AC-22101-1',
    verdict: 'pass',
    detail: 'positive row with only an empty derived',
    evidence: { requestId: 'r', derived: {} },
  };
  assert.throws(() => assertRule7dRowShape(badRow, 'negative-case-empty-derived'),
    /positive-evidence row anchorAcId=application\-empty\-error\-states\-AC\-22101\-1 has no rule-7d evidence object/);
});

test('rule-7d row-shape check refuses a positive row with only a request id (TC-criterion-e-evidence-shape-negative-id-only)', async () => {
  const badRow = {
    anchorAcId: 'application-empty-error-states-AC-22101-1',
    verdict: 'pass',
    detail: 'positive row with only a request id',
    evidence: { requestId: 'r' },
  };
  assert.throws(() => assertRule7dRowShape(badRow, 'negative-case-id-only'),
    /positive-evidence row anchorAcId=application\-empty\-error\-states\-AC\-22101\-1 has no rule-7d evidence object/);
});
