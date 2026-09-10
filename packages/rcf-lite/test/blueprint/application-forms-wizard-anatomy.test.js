// Anatomy + apply + probe-pack test for the application-forms-wizard
// v1.0.0 shelf blueprint (visual round 4 T-3, spec section 5.3).
//
// Covers TS-055.

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

import { startServer, STEP_STATES, TRANSPORTS, STEP_MANIFEST, BREAK_SWITCHES } from '../fixtures/probe-pack-application-forms-wizard/server.js';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..', '..', '..');
const BLUEPRINT_ROOT = join(REPO_ROOT, 'blueprints', 'application-forms-wizard');
const PACK_ABS = join(BLUEPRINT_ROOT, 'probe-packs', 'application-forms-wizard.pack.mjs');
const README_ABS = join(BLUEPRINT_ROOT, 'README.md');
const CHANGELOG_ABS = join(BLUEPRINT_ROOT, 'CHANGELOG.md');
const TOPICS_ABS = join(BLUEPRINT_ROOT, 'docs', 'topics.md');
const GUIDE_ABS = join(BLUEPRINT_ROOT, 'guide', 'application-forms-wizard.md');
const PACK_SRC_ABS = PACK_ABS;

test('blueprint.json declares 20 contributions with no capabilities and no requiresAppliedCapabilities (TC-055-blueprint-json-shape)', async () => {
  const doc = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  assert.equal(doc.slug, 'application-forms-wizard');
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
  assert.equal(reqs.length, 6, 'six REQs');
  assert.equal(uss.length, 8, 'eight USs (one per REQ plus three cross-cutting)');
  assert.equal(tacs.length, 3, 'three TACs');
  assert.equal(adrs.length, 3, 'three ADRs');
  assert.equal(doc.contributions.length, 20, '20 contributions total');
  const adrIds = adrs.map((a) => a.id).sort();
  assert.deepEqual(adrIds, [
    'ADR-2501-application-forms-wizard-navigation',
    'ADR-2502-application-forms-wizard-save-and-return',
    'ADR-2503-application-forms-wizard-step-indicator',
  ]);
  const adrClauses = adrs.map((a) => a.standardsTraceClause);
  assert.ok(adrClauses.every((c) => typeof c === 'string' && c.length > 0), 'every ADR contribution carries standardsTraceClause');
  // ADR-2502 ships WITHOUT recommendedDefault (or with recommendedDefault: false).
  const transportAdr = adrs.find((a) => a.id === 'ADR-2502-application-forms-wizard-save-and-return');
  assert.ok(transportAdr.recommendedDefault === undefined || transportAdr.recommendedDefault === false, 'ADR-2502 does not commit a recommendedDefault (spec section 5.3 and section 6 T-3 gate)');
  assert.equal(transportAdr.elicited, true, 'ADR-2502 carries elicited: true');
  // ADR-2501 (navigation) carries recommendedDefault: true on linear.
  const navAdr = adrs.find((a) => a.id === 'ADR-2501-application-forms-wizard-navigation');
  assert.equal(navAdr.recommendedDefault, true, 'ADR-2501 carries recommendedDefault: true (linear)');
});

test('applies cleanly on a fresh init project and adds 20 documents to the tree (TC-055-applies-clean)', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'forms-wizard-scratch-'));
  await initProject({ projectRoot: scratch, projectName: 'scratch' });
  const bp = await loadBlueprint(BLUEPRINT_ROOT);
  assert.equal(bp.slug, 'application-forms-wizard');
  const { tree } = await walkTree({ projectRoot: scratch });
  const result = await applyBlueprint({ projectRoot: scratch, tree, source: BLUEPRINT_ROOT });
  assert.equal(result.applied, true, JSON.stringify(result));
  assert.equal(result.slug, 'application-forms-wizard');
  const walked = await walkTree({ projectRoot: scratch });
  assert.deepEqual(walked.errors, []);
  const added = walked.tree.requirements.filter((r) => r.reqId.startsWith('application-forms-wizard-'));
  assert.equal(added.length, 6);
  const uss = walked.tree.userStories.filter((u) => u.usId.startsWith('application-forms-wizard-'));
  assert.equal(uss.length, 8);
});

test('every pack check id matches a contributed AC id and appliesTo binds tacIds AND route (TC-055-pack-checks-cross-check)', async () => {
  const acIds = await readContributedAcIds({ blueprintAbsPath: BLUEPRINT_ROOT });
  const packMod = await import(pathToFileURL(PACK_ABS).href);
  const validation = validatePackModule({ mod: packMod, blueprintSlug: 'application-forms-wizard', packAbsPath: PACK_ABS });
  assert.ok(validation.ok, JSON.stringify(validation.errors ?? []));
  const missing = validation.pack.checks.map((c) => c.id).filter((id) => !acIds.has(id));
  assert.deepEqual(missing, [], 'every pack check id must resolve to a contributed AC id');
  const expectedCheckIds = ['AC-24101-1', 'AC-24103-1', 'AC-24104-1', 'AC-24105-1'];
  const actual = validation.pack.checks.map((c) => c.id);
  assert.deepEqual(actual, expectedCheckIds, 'four pack checks anchored one per core contract');
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
  // GOV.UK vocabulary check: the pack names the four closed strings.
  for (const s of ['Cannot start yet', 'Not started', 'In progress', 'Completed']) {
    assert.ok(packText.includes(s), `pack names the closed GOV.UK vocabulary string ${JSON.stringify(s)}`);
  }
});

test('application-forms-wizard: pack loader discovers the shipped pack against an applied scratch project (TC-055-pack-loader-discovers)', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'forms-wizard-loader-'));
  await initProject({ projectRoot: scratch, projectName: 'scratch' });
  const { tree } = await walkTree({ projectRoot: scratch });
  await applyBlueprint({ projectRoot: scratch, tree, source: BLUEPRINT_ROOT });
  const { packs, errors, warnings } = await loadProbePacks({
    appliedBlueprints: [{ slug: 'application-forms-wizard', absPath: BLUEPRINT_ROOT }],
    projectRoot: scratch,
  });
  assert.deepEqual(errors, [], JSON.stringify(errors));
  assert.deepEqual(warnings, []);
  assert.equal(packs.length, 1);
  assert.equal(packs[0].packName, 'application-forms-wizard');
  assert.equal(packs[0].checks.length, 4);
});

test('sample-app fixture serves the four wizard surfaces and both draft-store transports (TC-055-fixture-serves-surfaces)', async () => {
  const { server, port } = await startServer({ port: 0 });
  try {
    assert.deepEqual(STEP_STATES, ['Cannot start yet', 'Not started', 'In progress', 'Completed'], 'fixture exports the four state slugs in the ratified GOV.UK order');
    assert.deepEqual(TRANSPORTS, ['server-draft-table', 'client-local-buffer'], 'fixture exports the two transport slugs in the ratified order');
    assert.deepEqual(BREAK_SWITCHES, ['task-list-vocab', 'no-summary', 'no-retain', 'no-draft'], 'fixture exports the four break switches in the ratified order');
    assert.ok(STEP_MANIFEST.length >= 2, 'step manifest has at least two steps');
    // Task-list surface renders the region carrying [data-surface="task-list"].
    const tlRes = await fetch(`http://127.0.0.1:${port}/task-list`);
    assert.equal(tlRes.status, 200);
    const tlHtml = await tlRes.text();
    assert.ok(tlHtml.includes('data-surface="task-list"'), 'task-list branch renders data-surface="task-list"');
    assert.ok(tlHtml.includes('role="progressbar"'), 'task-list branch renders the ARIA progressbar wrapper');
    assert.ok(/data-step-slug="contact-details"/.test(tlHtml), 'task-list branch renders the first step row');
    // Refused step pre-renders the error-summary shape.
    const refusedRes = await fetch(`http://127.0.0.1:${port}/step/2?refused=1`);
    assert.equal(refusedRes.status, 200);
    const refusedHtml = await refusedRes.text();
    assert.ok(refusedHtml.includes('data-surface="error-summary"'), 'refused step renders the error-summary region');
    assert.ok(/aria-invalid="true"/.test(refusedHtml), 'refused step marks the failed field aria-invalid');
    assert.ok(/aria-describedby="err-fullName"/.test(refusedHtml), 'refused step binds aria-describedby to the message id');
    // Summary review renders one section per step on ?seed=complete.
    const sumRes = await fetch(`http://127.0.0.1:${port}/summary?seed=complete`);
    assert.equal(sumRes.status, 200);
    const sumHtml = await sumRes.text();
    assert.ok(sumHtml.includes('data-surface="summary-review"'), 'summary branch renders the summary-review region');
    assert.ok(/data-summary-list-section/.test(sumHtml), 'summary branch renders at least one summary-list section');
    assert.ok(/data-recovery="change"/.test(sumHtml), 'summary branch renders the change link per row');
    // Server-side draft table round-trip: preseed then GET /drafts returns the field.
    const preseed = await fetch(`http://127.0.0.1:${port}/step/1?draft-store=server&preseed=1`);
    assert.equal(preseed.status, 200);
    const draftsRes = await fetch(`http://127.0.0.1:${port}/drafts`);
    assert.equal(draftsRes.status, 200);
    const draftsBody = await draftsRes.json();
    assert.ok(draftsBody.fields && Object.keys(draftsBody.fields).length >= 1, `GET /drafts must return a fields object with at least one entry after preseed; got ${JSON.stringify(draftsBody)}`);
    // In-progress list surface renders after the preseed.
    const inProgRes = await fetch(`http://127.0.0.1:${port}/in-progress`);
    assert.equal(inProgRes.status, 200);
    const inProgHtml = await inProgRes.text();
    assert.ok(inProgHtml.includes('data-surface="in-progress-list"'), 'in-progress renders the list surface when the draft store is non-empty');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('sample-app fixture break switches surface the four defects on the DOM (TC-055-negative-runs)', async () => {
  const { server, port } = await startServer({ port: 0 });
  try {
    // ?break=task-list-vocab swaps a state string away from the closed vocabulary.
    const vocabHtml = await (await fetch(`http://127.0.0.1:${port}/task-list?break=task-list-vocab`)).text();
    assert.ok(/data-step-state="kicked-off"/.test(vocabHtml), 'task-list-vocab break switch renders an out-of-vocabulary state string');
    // ?break=no-summary drops the error-summary region on the refused step.
    // (Match on the section opening tag, not the bare attribute string,
    // because the shell CSS block also names the attribute.)
    const noSumHtml = await (await fetch(`http://127.0.0.1:${port}/step/2?refused=1&break=no-summary`)).text();
    assert.ok(!/<section[^>]*data-surface="error-summary"/.test(noSumHtml), 'no-summary break switch drops the error-summary region');
    // ?break=no-retain wipes every unedited answer on the edit-and-save round-trip.
    const noRetHtml = await (await fetch(`http://127.0.0.1:${port}/summary?seed=complete&edit=contact-details.fullName&value=new&break=no-retain`)).text();
    // The edited field itself gets updated to the new value; every other row's <dd> is empty.
    assert.ok(/data-field-slug="contact-details\.email"><dt>email<\/dt><dd><\/dd>/.test(noRetHtml), 'no-retain break switch wipes the unedited email row');
    // ?break=no-draft drops the draft transport path.
    const noDraftHtml = await (await fetch(`http://127.0.0.1:${port}/step/1?draft-store=local&preseed=1&break=no-draft`)).text();
    assert.ok(!/window\.localStorage\.setItem/.test(noDraftHtml), 'no-draft break switch drops the localStorage write path from the local branch');
    assert.ok(/data-draft-store="none"/.test(noDraftHtml), 'no-draft break switch surfaces the [data-draft-store="none"] banner');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('four state slugs and two transport slugs appear identically across README guide pack and docs (TC-055-vocabulary-and-transport-parity)', async () => {
  const readme = await readFile(README_ABS, 'utf8');
  const guide = await readFile(GUIDE_ABS, 'utf8');
  const topics = await readFile(TOPICS_ABS, 'utf8');
  const packText = await readFile(PACK_ABS, 'utf8');
  const states = ['Cannot start yet', 'Not started', 'In progress', 'Completed'];
  for (const state of states) {
    assert.ok(readme.includes(state), `README names state "${state}"`);
    assert.ok(topics.includes(state), `docs/topics.md names state "${state}"`);
    assert.ok(guide.includes(state), `guide names state "${state}"`);
    assert.ok(packText.includes(state), `pack names state "${state}"`);
  }
  const transports = ['server-draft-table', 'client-local-buffer'];
  for (const transport of transports) {
    assert.ok(readme.includes(transport), `README names transport "${transport}"`);
    assert.ok(topics.includes(transport), `docs/topics.md names transport "${transport}"`);
    assert.ok(guide.includes(transport), `guide names transport "${transport}"`);
  }
});

test('README lists mechanism-reach gaps and CHANGELOG carries 1.0.0 and topics carries the T-3 row (TC-055-readme-gaps-and-changelog)', async () => {
  const readme = await readFile(README_ABS, 'utf8');
  const changelog = await readFile(CHANGELOG_ABS, 'utf8');
  const topics = await readFile(TOPICS_ABS, 'utf8');
  // README lists Known mechanism-reach gaps section and one bullet per runtime-observable AC not directly bound.
  assert.ok(readme.includes('Known mechanism-reach gaps'), 'README carries the Known mechanism-reach gaps section');
  for (const acId of ['AC-24101-1', 'AC-24102-1', 'AC-24103-1', 'AC-24104-1', 'AC-24105-1', 'AC-24106-1', 'AC-24107-1', 'AC-24108-1']) {
    assert.ok(readme.includes(acId), `README names ${acId} somewhere in the file`);
  }
  // CHANGELOG has exactly one 1.0.0 entry.
  assert.match(changelog, /## 1\.0\.0/, 'CHANGELOG carries the 1.0.0 heading');
  // docs/topics.md carries the T-3 shelf registry row plus the cross-reference to application-empty-error-states.
  assert.match(topics, /\| application-forms-wizard \| 24101-24899 \| 25xx \| shipped v1\.0\.0 \| none \|/, 'T-3 shelf registry row present in blueprint docs/topics.md');
  assert.ok(topics.includes('application-empty-error-states'), 'docs/topics.md cross-references application-empty-error-states (T-3 depends on T-1)');
});

test('application-forms-wizard: no em-dashes in shipped prose', async () => {
  const files = [README_ABS, CHANGELOG_ABS, GUIDE_ABS, TOPICS_ABS];
  for (const path of files) {
    const text = await readFile(path, 'utf8');
    assert.ok(!text.includes('—'), `${path} contains an em-dash (U+2014)`);
    assert.ok(!text.includes('–'), `${path} contains an en-dash (U+2013)`);
  }
});
