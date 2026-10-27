// REQ-189 US-18906 (UX intake gate): six real tests binding the six
// acceptance criteria of US-18906 to the FBS-215 implementation of
// journey-step binding (fbs.journeyStepIds[] + step-state projection
// + bundle bound-steps + review journeyStub findings). The P2/P3
// review-gate fixes (dex 2026-10-11, FBS-215 FINALISE) harden every
// AC body to kill the surviving mutations the Codex review named,
// and add two regression blocks for the F1 (post-write simulation
// drops discoveryJourney) and F2 (walker reads rcf/discovery/ into
// the shared error list) fixes.
//
// Each AC test name is kept verbatim from the DEFINE declaration so
// the testPointer on TC-248-18906-* resolves unchanged; the todo
// flag and placeholder bodies land as real coverage. Node 24
// built-ins only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { initProject } from '#core/store/init.js';
import { walkTree } from '#core/store/walker.js';

import {
  JOURNEY_FILE,
  declaredJourneyRecord,
  writeJourneyRecord,
} from '../../src/discovery/record.js';
import { computeStepStates } from '../../src/discovery/state.js';
import { computeQueue } from '../../src/build/queue.js';
import { assembleBundle } from '../../src/build/bundle.js';
import { formatMarkdown } from '../../src/build/formatters/markdown.js';
import { formatJson } from '../../src/build/formatters/json.js';
import { auditTestTheatre, aggregateVerdict } from '../../src/review/index.js';
import { computeCoverage, computeTrace, computeImpact } from '../../src/query/index.js';
import { scratchDir } from '../_helpers/scratch.js';
import { existsSync } from 'node:fs';
import { commit, initRepo } from '../_harness/git.js';
import { baseSuiteRecord } from '../_harness/fixture.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const BIN = resolve(repoRoot, 'bin', 'rcf.js');

/**
 * Build a declared journey record with one journey of two steps on
 * two screens. The returned record is schema-valid; callers may
 * mutate it before writing.
 */
function journeyRecordWithTwoSteps({ ui = 'central' } = {}) {
  const base = declaredJourneyRecord(ui, { by: 'test', reason: 'fixture: FBS-215 journey-binding tests' });
  base.screens = [
    { id: 'SCR-001', slug: 'home', title: null, wireframe: 'rcf/discovery/wireframes/home.md', references: [] },
    { id: 'SCR-002', slug: 'done', title: null, wireframe: 'rcf/discovery/wireframes/done.md', references: [] },
  ];
  base.journeys = [{
    id: 'JNY-001', slug: 'signup', actor: null, goal: null,
    source: 'rcf/discovery/journeys/signup.journey.md',
    steps: [
      { id: 'JNY-001-001', slug: 'start', kind: 'entry', screenId: 'SCR-001', label: 'Start here', next: ['JNY-001-002'], returnsTo: null },
      { id: 'JNY-001-002', slug: 'finish', kind: 'exit', screenId: 'SCR-002', label: 'All done', next: [], returnsTo: null },
    ],
    stepHighWaterMark: 2,
    interruptions: {},
  }];
  return base;
}

/** Write a minimal FBS doc into rcf/fbs/<id>.json for a scratch tree.
 *  initProject seeds a US-101 with AC-101-1; this FBS binds that AC so
 *  the schema's minItems-1 on acIds is satisfied. The init-seeded
 *  FBS-001 also carries AC-101-1 so we accept the deliberate (and
 *  harmless) acIdsCoverageDrift warn finding this creates: this suite
 *  tests the journey-binding features, not the broader review audit. */
async function writeFbs(projectRoot, overrides) {
  const base = {
    fbsId: 'FBS-900',
    prdId: 'PRD-001',
    bsId: 'BS-001',
    buildOrder: 2,
    executionStatus: 'notStarted',
    title: 'Scratch FBS',
    summary: 'Scratch FBS fixture for FBS-215 journey-binding tests.',
    acIds: ['AC-101-1'],
    dependsOnFbsIds: [],
    createdAt: '2026-10-11T00:00:00Z',
    updatedAt: '2026-10-11T00:00:00Z',
    ...overrides,
  };
  const path = join(projectRoot, 'rcf', 'fbs', `${base.fbsId.toLowerCase()}.json`);
  await writeFile(path, `${JSON.stringify(base, null, 2)}\n`, 'utf8');
  return base;
}

async function scaffold() {
  const scratch = await scratchDir('rcf-fbs215-');
  await initProject({ projectRoot: scratch, projectName: 'FBS-215 Scratch' });
  return scratch;
}

// --- AC-18906-1 -----------------------------------------------------------

// The base-suite record every rcf build bundle takes once FBS-239 lands
// (the stage-keeper's ruling RC-16 on the round C DEFINE, class C: the
// call shape changes, the criterion does not). TAC-4158 reads the record
// against the base, git merge-base of HEAD with the trunk (HEAD itself on
// the trunk), so the fixture is committed as the trunk main and a green
// BaseSuiteRecord v1 (the harness baseSuiteRecord) for that commit is
// written outside it, as test/cli/build-base-suite.test.js passes one.
async function baseSuiteArgs(root) {
  if (!existsSync(join(root, '.git'))) initRepo(root);
  const head = commit(root, 'fixture: base', {}, { allowEmpty: true });
  const file = join(await scratchDir('rcf-base-suite-'), 'base.json');
  await writeFile(file, `${JSON.stringify(baseSuiteRecord(head), null, 2)}\n`, 'utf8');
  return ['--base-suite', file];
}

test('AC-18906-1 happy: an fbs whose journeystepids all resolve to steps', async () => {
  // F9 mutation kill: bind TWO steps and exercise the real CLI
  // bundle formatters (both markdown and JSON), not just
  // assembleBundle directly. Truncating boundSteps to the first
  // element, or dropping boundSteps from either formatter, must now
  // break the test.
  const scratch = await scaffold();
  await writeJourneyRecord({ projectRoot: scratch, record: journeyRecordWithTwoSteps({ ui: 'central' }) });
  const fbs = await writeFbs(scratch, {
    fbsId: 'FBS-900',
    title: 'Scratch FBS binding both steps',
    journeyStepIds: ['JNY-001-001', 'JNY-001-002'],
  });

  const { tree, errors } = await walkTree({ projectRoot: scratch });
  // No brokenReference against FBS-900.journeyStepIds; walk is clean for the field.
  const refErr = errors.find((e) => e.kind === 'brokenReference' && (e.field ?? '').startsWith('journeyStepIds'));
  assert.equal(refErr, undefined, `validate must not surface a brokenReference on resolved journeyStepIds; got ${JSON.stringify(refErr)}`);

  // Both bound steps appear in the in-memory bundle, in record order,
  // with the full tuple (id, label, journey, screen slug, wireframe).
  const bundle = assembleBundle(tree, { fbsId: fbs.fbsId });
  assert.ok(bundle, 'assembleBundle returned null for a known FBS id');
  assert.deepEqual(
    bundle.boundSteps,
    [
      {
        stepId: 'JNY-001-001',
        resolved: true,
        journeyId: 'JNY-001',
        label: 'Start here',
        slug: 'start',
        screenId: 'SCR-001',
        screenSlug: 'home',
        wireframe: 'rcf/discovery/wireframes/home.md',
      },
      {
        stepId: 'JNY-001-002',
        resolved: true,
        journeyId: 'JNY-001',
        label: 'All done',
        slug: 'finish',
        screenId: 'SCR-002',
        screenSlug: 'done',
        wireframe: 'rcf/discovery/wireframes/done.md',
      },
    ],
    'boundSteps must list BOTH resolved steps with id, label, screen slug and wireframe path',
  );

  // Markdown bundle through the real CLI formatter: both rows render
  // byte-for-byte, with id | journey | label | screen slug | wireframe.
  const md = formatMarkdown(bundle, 'bundle');
  assert.match(md, /Bound journey steps:/, 'markdown bundle must carry a Bound journey steps block');
  assert.match(md, /JNY-001-001 \| JNY-001 \| Start here \| home \| rcf\/discovery\/wireframes\/home\.md/, 'the step-1 row must carry id, journey, label, screen slug and wireframe path verbatim');
  assert.match(md, /JNY-001-002 \| JNY-001 \| All done \| done \| rcf\/discovery\/wireframes\/done\.md/, 'the step-2 row must carry id, journey, label, screen slug and wireframe path verbatim');

  // JSON bundle through the REAL formatJson (F10 mutation kill: not a
  // re-stringify of the input). Dropping boundSteps from the JSON
  // output would now break this.
  const jsonBundleStr = formatJson(bundle, 'bundle');
  const jsonBundle = JSON.parse(jsonBundleStr);
  assert.ok(Array.isArray(jsonBundle.boundSteps), 'formatJson(bundle) must carry boundSteps[]');
  assert.equal(jsonBundle.boundSteps.length, 2, 'JSON bundle must carry both bound steps');
  assert.equal(jsonBundle.boundSteps[0].stepId, 'JNY-001-001', 'JSON bundle keeps record order');
  assert.equal(jsonBundle.boundSteps[1].stepId, 'JNY-001-002', 'JSON bundle keeps record order');
  assert.equal(jsonBundle.boundSteps[1].wireframe, 'rcf/discovery/wireframes/done.md', 'JSON bundle carries the wireframe path');

  // CLI build bundle --format json: end-to-end check that the real
  // binary emits boundSteps the same way (so swapping the formatter
  // or the composed envelope is caught by this body).
  const run = spawnSync(process.execPath, [BIN, 'build', 'bundle', fbs.fbsId, ...(await baseSuiteArgs(scratch)), '--format', 'json'], { cwd: scratch, encoding: 'utf8' });
  assert.equal(run.status, 0, `build bundle must exit 0; stderr=${run.stderr}`);
  const cliEnvelope = JSON.parse(run.stdout);
  assert.ok(Array.isArray(cliEnvelope.boundSteps), 'CLI build bundle --format json must carry boundSteps[]');
  assert.deepEqual(
    cliEnvelope.boundSteps.map((s) => s.stepId),
    ['JNY-001-001', 'JNY-001-002'],
    'CLI JSON bundle must carry both step ids in record order',
  );

  // rcf define validate exits 0 on the full tree (regression on F1 as
  // well: the authored bindings are not refused by post-write
  // validation on this clean path).
  const valid = spawnSync(process.execPath, [BIN, 'define', 'validate'], { cwd: scratch, encoding: 'utf8' });
  assert.equal(valid.status, 0, `define validate must exit 0 with resolved bindings; stderr=${valid.stderr}`);
});

// --- AC-18906-2 -----------------------------------------------------------

test('AC-18906-2 happy: a light or central product', async () => {
  // F10 + C2 mutation kill: cover every lifecycle mapping
  // (notStarted->queued, inProgress->inProgress, complete->built,
  // verified->verified) AND exercise formatJson directly from the
  // CLI build queue path, not a re-stringify of the in-memory
  // object. Light + central both get asserted (C2: light cases
  // never ran through the queue surface before).
  const scratch = await scaffold();
  // Four-step record so one FBS can take each lifecycle mapping.
  const record = journeyRecordWithTwoSteps({ ui: 'light' });
  record.screens.push(
    { id: 'SCR-003', slug: 'review', title: null, wireframe: 'rcf/discovery/wireframes/review.md', references: [] },
    { id: 'SCR-004', slug: 'thanks', title: null, wireframe: 'rcf/discovery/wireframes/thanks.md', references: [] },
  );
  record.journeys[0].steps.push(
    { id: 'JNY-001-003', slug: 'review', kind: 'step', screenId: 'SCR-003', label: 'Review', next: ['JNY-001-004'], returnsTo: null },
    { id: 'JNY-001-004', slug: 'thanks', kind: 'exit', screenId: 'SCR-004', label: 'Thanks', next: [], returnsTo: null },
  );
  record.journeys[0].stepHighWaterMark = 4;
  await writeJourneyRecord({ projectRoot: scratch, record });
  // One FBS per lifecycle mapping, each binding one step; the fifth
  // step would be unbound but we only have 4 steps so step-4 is
  // explicitly unbound here.
  await writeFbs(scratch, {
    fbsId: 'FBS-900',
    title: 'Step 1 notStarted (-> queued)',
    executionStatus: 'notStarted',
    journeyStepIds: ['JNY-001-001'],
  });
  await writeFbs(scratch, {
    fbsId: 'FBS-901',
    buildOrder: 3,
    title: 'Step 2 inProgress',
    executionStatus: 'inProgress',
    journeyStepIds: ['JNY-001-002'],
  });
  await writeFbs(scratch, {
    fbsId: 'FBS-902',
    buildOrder: 4,
    title: 'Step 3 complete (-> built)',
    executionStatus: 'complete',
    journeyStepIds: ['JNY-001-003'],
  });
  await writeFbs(scratch, {
    fbsId: 'FBS-903',
    buildOrder: 5,
    title: 'Step 4 verified',
    executionStatus: 'verified',
    journeyStepIds: ['JNY-001-004'],
  });

  const { tree } = await walkTree({ projectRoot: scratch });
  const queue = computeQueue(tree);
  assert.equal(queue.journeyApplicable, true, 'light product with a record must set journeyApplicable=true');
  assert.ok(Array.isArray(queue.journeySteps), 'queue result must carry journeySteps[]');
  const states = new Map(queue.journeySteps.map((row) => [row.stepId, row]));
  assert.equal(states.get('JNY-001-001').state, 'queued', 'notStarted must map to queued');
  assert.deepEqual(states.get('JNY-001-001').fbsIds, ['FBS-900'], 'step 1 fbsIds must list the bound FBS');
  assert.equal(states.get('JNY-001-002').state, 'inProgress', 'inProgress must map to inProgress');
  assert.equal(states.get('JNY-001-003').state, 'built', 'complete must map to built');
  assert.equal(states.get('JNY-001-004').state, 'verified', 'verified must map to verified');

  // Markdown queue output through the real formatter: header plus
  // every lifecycle row. Dropping the header (F3) or changing the
  // state mapping now breaks a specific assertion.
  const md = formatMarkdown(queue, 'queue');
  assert.match(md, /^Journey steps:$/m, 'queue markdown must carry a Journey steps section header');
  assert.match(md, /\| JNY-001-001 \| JNY-001 \| queued \| FBS-900 \|/, 'notStarted FBS renders as queued row');
  assert.match(md, /\| JNY-001-002 \| JNY-001 \| inProgress \| FBS-901 \|/, 'inProgress FBS renders as inProgress row');
  assert.match(md, /\| JNY-001-003 \| JNY-001 \| built \| FBS-902 \|/, 'complete FBS renders as built row');
  assert.match(md, /\| JNY-001-004 \| JNY-001 \| verified \| FBS-903 \|/, 'verified FBS renders as verified row');

  // JSON formatter: through the REAL formatJson (F10 kill). A
  // mutation that strips journeySteps from the JSON output must
  // break here.
  const jsonStr = formatJson(queue, 'queue');
  const jsonOut = JSON.parse(jsonStr);
  assert.ok(Array.isArray(jsonOut.journeySteps), 'formatJson queue must carry journeySteps[]');
  assert.equal(jsonOut.journeyApplicable, true, 'formatJson queue must carry journeyApplicable=true for a light product');
  const jsonByStep = new Map(jsonOut.journeySteps.map((row) => [row.stepId, row]));
  assert.equal(jsonByStep.get('JNY-001-001').state, 'queued');
  assert.equal(jsonByStep.get('JNY-001-002').state, 'inProgress');
  assert.equal(jsonByStep.get('JNY-001-003').state, 'built');
  assert.equal(jsonByStep.get('JNY-001-004').state, 'verified');

  // CLI build queue --format json: end-to-end check.
  const run = spawnSync(process.execPath, [BIN, 'build', 'queue', '--format', 'json'], { cwd: scratch, encoding: 'utf8' });
  assert.equal(run.status, 0, `build queue must exit 0; stderr=${run.stderr}`);
  const cliJson = JSON.parse(run.stdout);
  assert.ok(Array.isArray(cliJson.journeySteps) && cliJson.journeySteps.length === 4, 'CLI build queue JSON must carry all four journeySteps rows');

  // CLI journey show prints the derived state beside each step. Run
  // the real binary so the display path is end-to-end.
  const show = spawnSync(process.execPath, [BIN, 'discover', 'journey', 'show'], { cwd: scratch, encoding: 'utf8' });
  assert.equal(show.status, 0, `journey show must exit 0; stderr=${show.stderr}`);
  assert.match(show.stdout, /state: queued \(FBS-900\)/, 'journey show must print `state: queued (FBS-900)` beside the notStarted-bound step');
  assert.match(show.stdout, /state: inProgress \(FBS-901\)/, 'journey show must print inProgress beside the bound step');
  assert.match(show.stdout, /state: built \(FBS-902\)/, 'journey show must print built beside the complete-bound step');
  assert.match(show.stdout, /state: verified \(FBS-903\)/, 'journey show must print verified beside the verified-bound step');
});

// --- AC-18906-3 -----------------------------------------------------------

test('AC-18906-3 happy: rcf build review on a light or central product', async () => {
  // F11 mutation kill: run the real review CLI with --dry-run --json
  // and --skip-mutation; assert the verdict is exactly pass (not just
  // not-block), that the CLI exits 0 (so a warn promotion changes the
  // observed exit from 0 to 4 and breaks the test), and that each
  // journeyStub finding on the record carries anchorId verbatim. C2:
  // we also run the review against a LIGHT product (not just central)
  // so dropping light from the gate breaks the test.
  const scratch = await scaffold();
  await writeJourneyRecord({ projectRoot: scratch, record: journeyRecordWithTwoSteps({ ui: 'light' }) });
  // The audited FBS is uiBearing but names no journey steps -> one
  // journeyStub finding anchored on the FBS id. The record carries
  // two steps, neither bound by any FBS -> two journeyStub findings
  // anchored on the step ids. Three findings total.
  const auditedFbs = await writeFbs(scratch, {
    fbsId: 'FBS-900',
    title: 'uiBearing with empty journeyStepIds',
    uiBearing: true,
    journeyStepIds: [],
  });

  const { tree } = await walkTree({ projectRoot: scratch });
  const findings = auditTestTheatre({ tree, fbs: tree.byId.get(auditedFbs.fbsId) });
  const stubFindings = findings.filter((f) => f.kind === 'journeyStub');
  assert.equal(stubFindings.length, 3, `expected three journeyStub findings; got ${stubFindings.length} (${JSON.stringify(findings)})`);
  const anchors = stubFindings.map((f) => f.anchorId).sort();
  assert.deepEqual(anchors, ['FBS-900', 'JNY-001-001', 'JNY-001-002'], 'anchorIds must name the audited FBS and the two unbound step ids');
  for (const f of stubFindings) {
    assert.ok(f.detail.startsWith('journeyStub:'), `detail must start with "journeyStub:"; got ${f.detail}`);
    assert.equal(f.severity, 'advisory', 'journeyStub severity must be advisory (exit code unchanged)');
    assert.ok(typeof f.anchorId === 'string' && f.anchorId.length > 0, 'anchorId must be a non-empty string');
    assert.equal(f.tsId, undefined, 'journeyStub findings must not carry tsId');
  }
  // aggregateVerdict with mutationSampling of skipped mode: advisory
  // findings alone yield exactly pass (never warn or block). A
  // mutation that promotes advisory to warn would change this to
  // warn.
  const verdict = aggregateVerdict(stubFindings, { mode: 'skipped' });
  assert.equal(verdict, 'pass', `advisory journeyStub findings must yield pass; got ${verdict}`);

  // Real CLI review: dry-run, JSON out, skip mutation sampling so the
  // body does not need a wired agent. The CLI maps pass to exit 0 and
  // warn or block to exit 4 (src/cli/review.js:195); a warn promotion
  // flips this to 4.
  const run = spawnSync(process.execPath, [BIN, 'build', 'review', 'FBS-900', '--dry-run', '--json', '--skip-mutation', '--quiet'], { cwd: scratch, encoding: 'utf8' });
  assert.equal(run.status, 0, `build review must exit 0 on advisory-only findings; stderr=${run.stderr}`);
  // --quiet suppresses the human-readable dry-run block so stdout
  // is the composed JSON record alone (no second JSON object or
  // trailing text to confuse JSON.parse).
  const record = JSON.parse(run.stdout);
  assert.equal(record.verdict, 'pass', `review record verdict must be pass; got ${record.verdict}`);
  const cliStubFindings = (record.testTheatreFindings ?? []).filter((f) => f.kind === 'journeyStub');
  assert.equal(cliStubFindings.length, 3, 'CLI review JSON must carry all three journeyStub findings');
  // anchorId must round-trip through normaliseFinding and
  // JSON.stringify (a mutation that drops anchorId from normalise
  // breaks here).
  for (const f of cliStubFindings) {
    assert.ok(typeof f.anchorId === 'string' && f.anchorId.length > 0, `CLI JSON finding must carry anchorId; got ${JSON.stringify(f)}`);
    assert.equal(f.tsId, undefined, 'CLI JSON journeyStub findings must not carry tsId');
  }
  // Text dry-run also renders cleanly (F14 regression: no
  // "undefined" where the anchor should sit).
  const text = spawnSync(process.execPath, [BIN, 'build', 'review', 'FBS-900', '--dry-run', '--skip-mutation'], { cwd: scratch, encoding: 'utf8' });
  assert.equal(text.status, 0, `text dry-run must exit 0; stderr=${text.stderr}`);
  assert.doesNotMatch(text.stdout, /journeyStub undefined/, 'text dry-run must not print "undefined" for a journeyStub anchor');
  assert.match(text.stdout, /journeyStub FBS-900: journeyStub:/, 'text dry-run must render the FBS anchor');
  assert.match(text.stdout, /journeyStub JNY-001-001: journeyStub:/, 'text dry-run must render the step anchor');
});

// --- AC-18906-4 -----------------------------------------------------------

test('AC-18906-4 failure: an fbs whose journeystepids names an id that res', async () => {
  const scratch = await scaffold();
  await writeJourneyRecord({ projectRoot: scratch, record: journeyRecordWithTwoSteps({ ui: 'central' }) });
  await writeFbs(scratch, {
    fbsId: 'FBS-900',
    title: 'Binds a nonexistent step',
    journeyStepIds: ['JNY-001-999'],
  });

  const { errors } = await walkTree({ projectRoot: scratch });
  const refErr = errors.find((e) =>
    e.kind === 'brokenReference'
    && e.documentId === 'FBS-900'
    && (e.field ?? '').startsWith('journeyStepIds')
    && (e.message ?? '').includes('JNY-001-999')
  );
  assert.ok(refErr, `expected a brokenReference naming FBS-900 and JNY-001-999; got ${JSON.stringify(errors)}`);

  // journey show lists FBS-900 under the broken-binding line.
  const run = spawnSync(process.execPath, [BIN, 'discover', 'journey', 'show'], { cwd: scratch, encoding: 'utf8' });
  assert.equal(run.status, 0, `journey show must exit 0; stderr=${run.stderr}`);
  assert.match(run.stdout, /broken-binding:/, 'journey show must print a broken-binding header');
  assert.match(run.stdout, /FBS-900: JNY-001-999/, 'broken-binding line must name the FBS and the unresolved id');

  // F5 regression: with the record DELETED (grandfathered-by-absence,
  // ADR-4145), journey show still prints a broken-binding line for
  // any FBS carrying journeyStepIds. The notice above still prints;
  // the broken-binding block is additive, not an override.
  await unlink(join(scratch, JOURNEY_FILE));
  const absent = spawnSync(process.execPath, [BIN, 'discover', 'journey', 'show'], { cwd: scratch, encoding: 'utf8' });
  assert.equal(absent.status, 0, `journey show with no record must exit 0; stderr=${absent.stderr}`);
  assert.match(absent.stdout, /no rcf\/discovery\/journey\.json/, 'show must still print the grandfather notice');
  assert.match(absent.stdout, /broken-binding:/, 'show must list broken-binding even with no record');
  assert.match(absent.stdout, /FBS-900: JNY-001-999/, 'broken-binding row must name the FBS and the unresolved id');
});

// --- AC-18906-5 -----------------------------------------------------------

test('AC-18906-5 edge: a step bound to two build specs with executionst', async () => {
  // F12 mutation kill: exercise BOTH orderings of every mapping-pair
  // claim the AC makes, not just the complete-first case. An
  // order-sensitive implementation (reset-on-complete) would pass the
  // complete-first fixture and fail the inProgress-first fixture.
  const recordA = journeyRecordWithTwoSteps({ ui: 'central' });
  const recordB = journeyRecordWithTwoSteps({ ui: 'central' });

  // Case A1: complete + inProgress (complete first) -> inProgress.
  const statesA1 = computeStepStates({
    tree: {
      fbsItems: [
        { fbsId: 'FBS-A1', executionStatus: 'complete', journeyStepIds: ['JNY-001-001'] },
        { fbsId: 'FBS-A2', executionStatus: 'inProgress', journeyStepIds: ['JNY-001-001'] },
      ],
    },
    record: recordA,
  });
  const stepA1 = statesA1.find((r) => r.stepId === 'JNY-001-001');
  assert.equal(stepA1.state, 'inProgress', `complete + inProgress (complete first) -> inProgress; got ${stepA1.state}`);
  assert.deepEqual(stepA1.fbsIds.sort(), ['FBS-A1', 'FBS-A2'], 'both bindings must appear on fbsIds');

  // Case A2: SAME pair, reversed order (inProgress first) -> still inProgress.
  const statesA2 = computeStepStates({
    tree: {
      fbsItems: [
        { fbsId: 'FBS-A2', executionStatus: 'inProgress', journeyStepIds: ['JNY-001-001'] },
        { fbsId: 'FBS-A1', executionStatus: 'complete', journeyStepIds: ['JNY-001-001'] },
      ],
    },
    record: recordA,
  });
  const stepA2 = statesA2.find((r) => r.stepId === 'JNY-001-001');
  assert.equal(stepA2.state, 'inProgress', `inProgress + complete (inProgress first) -> inProgress; got ${stepA2.state}`);

  // Case B1: complete + verified (complete first) -> built.
  const statesB1 = computeStepStates({
    tree: {
      fbsItems: [
        { fbsId: 'FBS-B1', executionStatus: 'complete', journeyStepIds: ['JNY-001-001'] },
        { fbsId: 'FBS-B2', executionStatus: 'verified', journeyStepIds: ['JNY-001-001'] },
      ],
    },
    record: recordB,
  });
  const stepB1 = statesB1.find((r) => r.stepId === 'JNY-001-001');
  assert.equal(stepB1.state, 'built', `complete + verified (complete first) -> built; got ${stepB1.state}`);

  // Case B2: verified + complete (verified first) -> still built.
  const statesB2 = computeStepStates({
    tree: {
      fbsItems: [
        { fbsId: 'FBS-B2', executionStatus: 'verified', journeyStepIds: ['JNY-001-001'] },
        { fbsId: 'FBS-B1', executionStatus: 'complete', journeyStepIds: ['JNY-001-001'] },
      ],
    },
    record: recordB,
  });
  const stepB2 = statesB2.find((r) => r.stepId === 'JNY-001-001');
  assert.equal(stepB2.state, 'built', `verified + complete (verified first) -> built; got ${stepB2.state}`);

  // Case C: notStarted + inProgress -> inProgress (notStarted maps
  // to queued, queued < inProgress). Both orderings.
  for (const order of [
    [
      { fbsId: 'FBS-C1', executionStatus: 'notStarted', journeyStepIds: ['JNY-001-001'] },
      { fbsId: 'FBS-C2', executionStatus: 'inProgress', journeyStepIds: ['JNY-001-001'] },
    ],
    [
      { fbsId: 'FBS-C2', executionStatus: 'inProgress', journeyStepIds: ['JNY-001-001'] },
      { fbsId: 'FBS-C1', executionStatus: 'notStarted', journeyStepIds: ['JNY-001-001'] },
    ],
  ]) {
    const states = computeStepStates({ tree: { fbsItems: order }, record: recordA });
    const step = states.find((r) => r.stepId === 'JNY-001-001');
    assert.equal(step.state, 'queued', `notStarted + inProgress -> queued (least advanced); got ${step.state} with order ${order.map((o) => o.fbsId).join(',')}`);
  }
});

// --- AC-18906-6 -----------------------------------------------------------

test('AC-18906-6 must-not: journeystepids on any fbs', async () => {
  // F13 mutation kill: seed designStage.journeys on the FBS and
  // assert bytes survive the walk and the audit surfaces. Also run
  // the real audit CLIs (coverage / trace / impact) in JSON mode so a
  // formatter-only leak of journey ids would surface. The walker
  // errors are now surfaced (not discarded) so a chain-load regression
  // breaks the test.
  const scratch = await scaffold();
  await writeJourneyRecord({ projectRoot: scratch, record: journeyRecordWithTwoSteps({ ui: 'central' }) });
  const authoredDesignStage = {
    journeys: [
      {
        id: 'legacy-a',
        actor: 'legacy actor A',
        goal: 'exercise the legacy designStage.journeys block',
        steps: ['legacy A step 1', 'legacy A step 2'],
      },
      {
        id: 'legacy-b',
        actor: 'legacy actor B',
        goal: 'carry a second journey so the block has mass',
        steps: ['legacy B step 1', 'legacy B step 2'],
      },
    ],
    authoredBy: 'FBS-215 F13 regression fixture',
  };
  const fbs = await writeFbs(scratch, {
    fbsId: 'FBS-900',
    title: 'Carries bindings AND a legacy designStage block',
    journeyStepIds: ['JNY-001-001', 'JNY-001-002'],
    designStage: authoredDesignStage,
  });

  const { tree, errors } = await walkTree({ projectRoot: scratch });
  assert.equal(errors.length, 0, `walk must be clean on this fixture; got ${JSON.stringify(errors)}`);
  const walkedFbs = tree.byId.get(fbs.fbsId);
  assert.ok(walkedFbs, 'walker must index FBS-900');

  // designStage survives byte-for-byte: a mutation that clears or
  // rewrites it from the binding path would break here (not just a
  // "designStage absent" assertion as before).
  assert.deepEqual(walkedFbs.designStage, authoredDesignStage, 'the walker must leave designStage.journeys[] exactly as authored');

  // computeCoverage: no journey id anywhere in the serialised output.
  const coverage = computeCoverage(tree);
  const coverageJson = JSON.stringify(coverage);
  assert.ok(!/JNY-001-/.test(coverageJson), 'coverage output must not carry JNY step ids');

  // computeTrace (both directions) for the FBS id: still no journey
  // ids in the serialised trace.
  const trace = computeTrace(tree, { id: fbs.fbsId, direction: 'both' });
  const traceJson = JSON.stringify(trace);
  assert.ok(!/JNY-001-/.test(traceJson), 'trace output must not carry JNY step ids');

  // computeImpact for the FBS id: still no journey ids in the
  // serialised impact graph.
  const impact = computeImpact(tree, { id: fbs.fbsId });
  const impactJson = JSON.stringify(impact);
  assert.ok(!/JNY-001-/.test(impactJson), 'impact output must not carry JNY step ids');

  // Real CLI audits in JSON mode: a formatter-only leak of journey
  // ids (CN rendering) would surface here even if the in-memory
  // compute is clean.
  const cov = spawnSync(process.execPath, [BIN, 'audit', 'coverage', '--format', 'json'], { cwd: scratch, encoding: 'utf8' });
  assert.ok(cov.status === 0 || cov.status === 4, `audit coverage exit must be 0 or 4 (strict), got ${cov.status}; stderr=${cov.stderr}`);
  assert.ok(!/JNY-001-/.test(cov.stdout), 'audit coverage CLI JSON must not carry JNY step ids');
  const tr = spawnSync(process.execPath, [BIN, 'audit', 'trace', fbs.fbsId, '--forward', '--format', 'json'], { cwd: scratch, encoding: 'utf8' });
  assert.equal(tr.status, 0, `audit trace must exit 0; stderr=${tr.stderr}`);
  assert.ok(!/JNY-001-/.test(tr.stdout), 'audit trace CLI JSON must not carry JNY step ids');
  const im = spawnSync(process.execPath, [BIN, 'audit', 'impact', fbs.fbsId, '--format', 'json'], { cwd: scratch, encoding: 'utf8' });
  assert.equal(im.status, 0, `audit impact must exit 0; stderr=${im.stderr}`);
  assert.ok(!/JNY-001-/.test(im.stdout), 'audit impact CLI JSON must not carry JNY step ids');
});

// --- Regression: F1 (post-write simulation keeps discoveryJourney) ---------

test('FBS-215 regression: define update authors a valid binding and tolerates unrelated writes on a bound tree', async () => {
  // F1 (P0): the post-write simulation reconstructed the tree
  // without copying discoveryJourney, so EVERY binding looked
  // unresolved to the simulation. The sanctioned authoring verb was
  // defeated (even valid bindings refused), and every unrelated
  // update on a tree that already carried valid bindings was refused
  // too. This body authors a binding and then changes an unrelated
  // field; both must succeed.
  const scratch = await scaffold();
  await writeJourneyRecord({ projectRoot: scratch, record: journeyRecordWithTwoSteps({ ui: 'central' }) });
  await writeFbs(scratch, {
    fbsId: 'FBS-900',
    title: 'Scratch FBS to receive a binding',
    journeyStepIds: [],
  });

  // Author a valid binding through the sanctioned verb.
  const author = spawnSync(
    process.execPath,
    [BIN, 'define', 'update', 'FBS-900', '--json', '--set', 'journeyStepIds=["JNY-001-002"]'],
    { cwd: scratch, encoding: 'utf8' },
  );
  assert.equal(author.status, 0, `define update must author a valid binding (exit 0); got ${author.status}; stderr=${author.stderr}`);

  // Change an unrelated field on an unrelated document on the now
  // bound tree: must not be refused by net-new post-write errors.
  const unrelated = spawnSync(
    process.execPath,
    [BIN, 'define', 'update', 'REQ-001', '--set', 'title=touched for FBS-215 F1 regression'],
    { cwd: scratch, encoding: 'utf8' },
  );
  assert.equal(unrelated.status, 0, `unrelated define update on a bound tree must succeed; got ${unrelated.status}; stderr=${unrelated.stderr}`);

  // define validate must stay clean on the final tree.
  const valid = spawnSync(process.execPath, [BIN, 'define', 'validate'], { cwd: scratch, encoding: 'utf8' });
  assert.equal(valid.status, 0, `define validate must exit 0 on the bound tree; stderr=${valid.stderr}`);
});

// --- Regression: F2 (walker never routes discovery load errors to audit) ---

test('FBS-215 regression: a malformed journey.json does not block audit coverage/trace/impact/queue', async () => {
  // F2 (P1): the walker pushed a discovery-record load error onto
  // its shared error list, so audit coverage / trace / impact /
  // build queue all exited 3 (shared "walker errors" refusal). This
  // body corrupts the record file and asserts the audit CLIs stay
  // on their intrinsic exits (0 or 4 for coverage strict), while
  // `define validate` still exits 3 with the discovery message.
  const scratch = await scaffold();
  await writeJourneyRecord({ projectRoot: scratch, record: journeyRecordWithTwoSteps({ ui: 'central' }) });
  // Clobber the record file with malformed JSON.
  await writeFile(join(scratch, JOURNEY_FILE), '{not json', 'utf8');

  const cov = spawnSync(process.execPath, [BIN, 'audit', 'coverage', '--format', 'json'], { cwd: scratch, encoding: 'utf8' });
  assert.ok(cov.status === 0 || cov.status === 4, `audit coverage must stay on its own exit path (0 or 4); got ${cov.status}; stderr=${cov.stderr}`);
  const tr = spawnSync(process.execPath, [BIN, 'audit', 'trace', 'FBS-001', '--forward', '--format', 'json'], { cwd: scratch, encoding: 'utf8' });
  assert.equal(tr.status, 0, `audit trace must stay on its own exit path (0); got ${tr.status}; stderr=${tr.stderr}`);
  const im = spawnSync(process.execPath, [BIN, 'audit', 'impact', 'FBS-001', '--format', 'json'], { cwd: scratch, encoding: 'utf8' });
  assert.equal(im.status, 0, `audit impact must stay on its own exit path (0); got ${im.status}; stderr=${im.stderr}`);
  const q = spawnSync(process.execPath, [BIN, 'build', 'queue', '--format', 'json'], { cwd: scratch, encoding: 'utf8' });
  assert.equal(q.status, 0, `build queue must stay on its own exit path (0) with a malformed journey.json; got ${q.status}; stderr=${q.stderr}`);

  // define validate IS the sanctioned surfacing path for a
  // discovery-record parse / schema failure (ADR-4142). Exit 3 with
  // the discovery/journey.json message in the output.
  const valid = spawnSync(process.execPath, [BIN, 'define', 'validate'], { cwd: scratch, encoding: 'utf8' });
  assert.equal(valid.status, 3, `define validate must exit 3 on malformed journey.json; got ${valid.status}; stderr=${valid.stderr}`);
  const validOut = `${valid.stdout}\n${valid.stderr}`;
  assert.match(validOut, /discovery\/journey\.json/, 'define validate must name the journey.json file in its message');
});

// --- Regression: F4 (queue block respects UI posture) ---------------------

test('FBS-215 regression: queue journeySteps is suppressed for ui=none and ui=null products', async () => {
  // F4 (P2): the queue surface rendered a journeySteps block from
  // any present record, including ui=none and ui=null (undeclared).
  // This body walks a tree where the record was later lowered to
  // ui=none and asserts that build queue markdown no longer renders
  // the block even though the record still carries journeys.
  const scratch = await scaffold();
  const record = journeyRecordWithTwoSteps({ ui: 'none' });
  // Keep the authored journeys in the record despite ui=none (a
  // lowered-to-none product retains its history).
  await writeJourneyRecord({ projectRoot: scratch, record });
  await writeFbs(scratch, {
    fbsId: 'FBS-900',
    title: 'Not uiBearing; no bindings',
    journeyStepIds: [],
  });

  const { tree } = await walkTree({ projectRoot: scratch });
  const queue = computeQueue(tree);
  assert.equal(queue.journeyApplicable, false, 'ui=none must suppress the journey block');
  assert.deepEqual(queue.journeySteps, [], 'ui=none must emit an empty journeySteps[]');
  const md = formatMarkdown(queue, 'queue');
  assert.doesNotMatch(md, /^Journey steps:$/m, 'ui=none must not render the Journey steps section header');
});
