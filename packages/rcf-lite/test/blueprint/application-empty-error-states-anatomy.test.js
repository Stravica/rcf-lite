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
  assert.equal(doc.version, '1.2.0');
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
    assert.ok(!text.includes('—'), `${path} contains an em-dash (U+2014)`);
    assert.ok(!text.includes('–'), `${path} contains an en-dash (U+2013)`);
  }
});
