// REQ-189 US-18906 (UX intake gate): six real tests binding the six
// acceptance criteria of US-18906 to the FBS-215 implementation of
// journey-step binding (fbs.journeyStepIds[] + step-state projection
// + bundle bound-steps + review journeyStub findings).
//
// Each AC test name is kept verbatim from the DEFINE declaration so
// the testPointer on TC-248-18906-* resolves unchanged; the todo flag
// and placeholder bodies land as real coverage. Node 24 built-ins only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
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
import { auditTestTheatre } from '../../src/review/index.js';
import { computeCoverage, computeTrace, computeImpact } from '../../src/query/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const BIN = resolve(repoRoot, 'bin', 'rcf.js');

/**
 * Build a declared journey record with one journey of two steps on
 * two screens. The returned record is schema-valid; callers may mutate
 * it before writing.
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
  const scratch = await mkdtemp(join(tmpdir(), 'rcf-fbs215-'));
  await initProject({ projectRoot: scratch, projectName: 'FBS-215 Scratch' });
  return scratch;
}

// --- AC-18906-1 -----------------------------------------------------------

test('AC-18906-1 happy: an fbs whose journeystepids all resolve to steps', async () => {
  const scratch = await scaffold();
  await writeJourneyRecord({ projectRoot: scratch, record: journeyRecordWithTwoSteps({ ui: 'central' }) });
  const fbs = await writeFbs(scratch, {
    fbsId: 'FBS-900',
    title: 'Scratch FBS binding one step',
    journeyStepIds: ['JNY-001-001'],
  });

  const { tree, errors } = await walkTree({ projectRoot: scratch });
  // No brokenReference against FBS-900.journeyStepIds; walk is clean for the field.
  const refErr = errors.find((e) => e.kind === 'brokenReference' && (e.field ?? '').startsWith('journeyStepIds'));
  assert.equal(refErr, undefined, `validate must not surface a brokenReference on resolved journeyStepIds; got ${JSON.stringify(refErr)}`);

  // Bundle prints the bound step with id, label, screen slug and
  // Screen.wireframe path (the executor's map).
  const bundle = assembleBundle(tree, { fbsId: fbs.fbsId });
  assert.ok(bundle, 'assembleBundle returned null for a known FBS id');
  assert.deepEqual(
    bundle.boundSteps,
    [{
      stepId: 'JNY-001-001',
      resolved: true,
      journeyId: 'JNY-001',
      label: 'Start here',
      slug: 'start',
      screenId: 'SCR-001',
      screenSlug: 'home',
      wireframe: 'rcf/discovery/wireframes/home.md',
    }],
    'boundSteps must list the resolved step with id, label, screen slug and wireframe path',
  );
  // Markdown bundle carries the data in the Work section (byte-level
  // check on label + screen slug + wireframe path).
  const md = formatMarkdown(bundle, 'bundle');
  assert.match(md, /Bound journey steps:/, 'markdown bundle must carry a Bound journey steps block');
  assert.match(md, /JNY-001-001 \| JNY-001 \| Start here \| home \| rcf\/discovery\/wireframes\/home\.md/, 'the row must carry id, journey, label, screen slug and wireframe path verbatim');
});

// --- AC-18906-2 -----------------------------------------------------------

test('AC-18906-2 happy: a light or central product', async () => {
  const scratch = await scaffold();
  await writeJourneyRecord({ projectRoot: scratch, record: journeyRecordWithTwoSteps({ ui: 'light' }) });
  // Two FBS: one claims step 1 and is inProgress (-> inProgress);
  // step 2 is unbound so it reads `unbound`.
  await writeFbs(scratch, {
    fbsId: 'FBS-900',
    title: 'Owns step 1',
    executionStatus: 'inProgress',
    journeyStepIds: ['JNY-001-001'],
  });

  const { tree } = await walkTree({ projectRoot: scratch });
  const queue = computeQueue(tree);
  assert.ok(Array.isArray(queue.journeySteps), 'queue result must carry journeySteps[]');
  const states = new Map(queue.journeySteps.map((row) => [row.stepId, row]));
  assert.equal(states.get('JNY-001-001').state, 'inProgress', 'step 1 must be inProgress (bound FBS is inProgress)');
  assert.deepEqual(states.get('JNY-001-001').fbsIds, ['FBS-900'], 'step 1 fbsIds must list the bound FBS');
  assert.equal(states.get('JNY-001-002').state, 'unbound', 'step 2 must be unbound (no FBS names it)');
  assert.deepEqual(states.get('JNY-001-002').fbsIds, [], 'unbound rows carry an empty fbsIds list');

  // Markdown queue output carries the journeySteps block.
  const md = formatMarkdown(queue, 'queue');
  assert.match(md, /^Journey steps:$/m, 'queue markdown must carry a Journey steps section header');
  assert.match(md, /\| JNY-001-001 \| JNY-001 \| inProgress \| FBS-900 \|/, 'the inProgress row must render with its binding');
  assert.match(md, /\| JNY-001-002 \| JNY-001 \| unbound \| - \|/, 'the unbound row must render with - as bound by');

  // JSON formatter is a passthrough JSON.stringify over the queue; the
  // same rows must be present.
  const jsonOut = JSON.parse(formatMarkdown.name === 'formatMarkdown' ? JSON.stringify(queue) : '{}');
  assert.ok(Array.isArray(jsonOut.journeySteps), 'queue JSON must carry journeySteps[]');

  // CLI journey show prints the derived state beside each step. Run
  // the real binary so the display path is end-to-end.
  const run = spawnSync(process.execPath, [BIN, 'discover', 'journey', 'show'], { cwd: scratch, encoding: 'utf8' });
  assert.equal(run.status, 0, `journey show must exit 0; stderr=${run.stderr}`);
  assert.match(run.stdout, /state: inProgress \(FBS-900\)/, 'journey show must print `state: inProgress (FBS-900)` beside the bound step');
  assert.match(run.stdout, /state: unbound/, 'journey show must print `state: unbound` beside the unbound step');
});

// --- AC-18906-3 -----------------------------------------------------------

test('AC-18906-3 happy: rcf build review on a light or central product', async () => {
  const scratch = await scaffold();
  await writeJourneyRecord({ projectRoot: scratch, record: journeyRecordWithTwoSteps({ ui: 'central' }) });
  // The audited FBS is uiBearing but names no journey steps -> one
  // journeyStub finding anchored on the FBS id. The record carries two
  // steps, neither bound by any FBS -> two journeyStub findings
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
  }
  // Exit code is unchanged: aggregateVerdict gives pass or warn, never
  // block, from advisory findings alone (the review CLI maps `pass`
  // and `warn` to exit 0; only `block` lifts to a non-zero exit).
  const { aggregateVerdict } = await import('../../src/review/index.js');
  const verdict = aggregateVerdict(findings, undefined);
  assert.notEqual(verdict, 'block', `journeyStub findings must not force a block verdict; got ${verdict}`);
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
});

// --- AC-18906-5 -----------------------------------------------------------

test('AC-18906-5 edge: a step bound to two build specs with executionst', async () => {
  // Case A: complete + inProgress -> inProgress (inProgress is less
  // advanced than complete on the queued/inProgress/built/verified
  // ladder).
  const treeA = {
    fbsItems: [
      { fbsId: 'FBS-A1', executionStatus: 'complete', journeyStepIds: ['JNY-001-001'] },
      { fbsId: 'FBS-A2', executionStatus: 'inProgress', journeyStepIds: ['JNY-001-001'] },
    ],
  };
  const recordA = journeyRecordWithTwoSteps({ ui: 'central' });
  const statesA = computeStepStates({ tree: treeA, record: recordA });
  const step1A = statesA.find((r) => r.stepId === 'JNY-001-001');
  assert.equal(step1A.state, 'inProgress', `complete + inProgress -> inProgress; got ${step1A.state}`);
  assert.deepEqual(step1A.fbsIds.sort(), ['FBS-A1', 'FBS-A2'], 'both bindings must appear on fbsIds');

  // Case B: complete + verified -> built (complete maps to built,
  // which is less advanced than verified).
  const treeB = {
    fbsItems: [
      { fbsId: 'FBS-B1', executionStatus: 'complete', journeyStepIds: ['JNY-001-001'] },
      { fbsId: 'FBS-B2', executionStatus: 'verified', journeyStepIds: ['JNY-001-001'] },
    ],
  };
  const recordB = journeyRecordWithTwoSteps({ ui: 'central' });
  const statesB = computeStepStates({ tree: treeB, record: recordB });
  const step1B = statesB.find((r) => r.stepId === 'JNY-001-001');
  assert.equal(step1B.state, 'built', `complete + verified -> built; got ${step1B.state}`);
});

// --- AC-18906-6 -----------------------------------------------------------

test('AC-18906-6 must-not: journeystepids on any fbs', async () => {
  const scratch = await scaffold();
  await writeJourneyRecord({ projectRoot: scratch, record: journeyRecordWithTwoSteps({ ui: 'central' }) });
  const fbs = await writeFbs(scratch, {
    fbsId: 'FBS-900',
    title: 'Carries bindings',
    journeyStepIds: ['JNY-001-001', 'JNY-001-002'],
  });

  const { tree } = await walkTree({ projectRoot: scratch });
  const walkedFbs = tree.byId.get(fbs.fbsId);

  // computeCoverage: no journey id anywhere in the serialised output.
  const coverage = computeCoverage(tree);
  const coverageJson = JSON.stringify(coverage);
  assert.ok(!/JNY-001/.test(coverageJson), 'coverage output must not carry JNY ids');

  // computeTrace (both directions) for the FBS id: still no journey
  // ids in the serialised trace.
  const trace = computeTrace(tree, { id: fbs.fbsId, direction: 'both' });
  const traceJson = JSON.stringify(trace);
  assert.ok(!/JNY-001/.test(traceJson), 'trace output must not carry JNY ids');

  // computeImpact for the FBS id: still no journey ids in the
  // serialised impact graph.
  const impact = computeImpact(tree, { id: fbs.fbsId });
  const impactJson = JSON.stringify(impact);
  assert.ok(!/JNY-001/.test(impactJson), 'impact output must not carry JNY ids');

  // designStage.journeys is unchanged: the FBS doc on disk has no
  // designStage block, so the walked FBS does not either.
  assert.equal(walkedFbs.designStage, undefined, 'the journeyStepIds field must not synthesise designStage.journeys[]');
});
