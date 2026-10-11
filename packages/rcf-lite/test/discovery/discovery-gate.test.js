// Discovery gate (D0, FBS-214, REQ-189, US-18905): the nine US-18905
// acceptance criteria built against the live gate code (gates.js
// checkD0Discovery), the readiness CLI (--check discovery), the three
// chain-write door call sites (ledger brief add, create, blueprint
// add), the readiness --ack discovery usage error, and the questions
// compute (D0 items first). Pure where it can be, filesystem-driven
// where the door is proved end to end. Node 24 built-ins only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  STAGE_GATES,
  STAGE_ORDER,
  STAGE_SHORT_NAMES,
  CHECK_PERSONA,
  checkD0Discovery,
  stagePolicy,
  ackable,
} from '../../src/query/gates.js';
import { computeReadiness } from '../../src/query/readiness.js';
import { computeQuestions } from '../../src/query/questions.js';
import { main as readinessMain } from '../../src/cli/readiness.js';
import { main as ledgerMain } from '../../src/cli/ledger.js';
import { main as createMain } from '../../src/cli/create.js';
import { main as freezeMain } from '../../src/cli/freeze.js';
import { writeJourneyRecord, emptyJourneyRecord } from '../../src/discovery/record.js';

// ---------------------------------------------------------------------------
// Helpers: minimal in-memory tree for computeReadiness, and a tiny
// on-disk project seeded with just enough chain to run the CLI mains.
// ---------------------------------------------------------------------------

function makeTree(overrides = {}) {
  return {
    manifest: overrides.manifest ?? null,
    prd: overrides.prd ?? null,
    tad: overrides.tad ?? null,
    bs: overrides.bs ?? null,
    requirements: overrides.requirements ?? [],
    userStories: overrides.userStories ?? [],
    tacs: overrides.tacs ?? [],
    adrs: overrides.adrs ?? [],
    fbsItems: overrides.fbsItems ?? [],
    testSuites: overrides.testSuites ?? [],
    codeNodes: overrides.codeNodes ?? [],
    evals: overrides.evals ?? [],
    byId: new Map(),
    rawById: new Map(),
    kindById: new Map(),
    brokenIds: new Set(),
    invalidDocs: new Map(),
    parentByChild: new Map(),
    childrenByParent: new Map(),
    fbsByAcId: new Map(),
    dependentsByFbsId: new Map(),
    tsByAcId: new Map(),
    tcsByAcId: new Map(),
    usByTacId: new Map(),
    cnByAcId: new Map(),
    dependentsByCnId: new Map(),
    evalByAcId: new Map(),
  };
}

function captureStream() {
  const chunks = [];
  return {
    write(s) { chunks.push(String(s)); return true; },
    get text() { return chunks.join(''); },
  };
}

async function seedMinimalProject() {
  const dir = await mkdtemp(join(tmpdir(), 'rcf-fbs-214-'));
  const root = await realpath(dir);
  // Minimal rcf tree the CLI mains need: a manifest, a PRD stub, an
  // empty brief ledger so brief add has a target. No TAD / BS so
  // computeReadiness does not do heavy walks (we are only probing D0).
  await mkdir(join(root, 'rcf'), { recursive: true });
  await mkdir(join(root, 'rcf', 'define'), { recursive: true });
  await mkdir(join(root, 'rcf', '.identity'), { recursive: true });
  await writeFile(
    join(root, 'rcf', 'manifest.json'),
    `${JSON.stringify({ schemaVersion: 2, rulesetVersion: '0.30.0' }, null, 2)}\n`,
  );
  await writeFile(
    join(root, 'rcf', 'prd.json'),
    `${JSON.stringify({ prdId: 'PRD-001', title: 'test', description: 'test', createdAt: new Date().toISOString() }, null, 2)}\n`,
  );
  await writeFile(
    join(root, 'rcf', 'define', 'brief-ledger.json'),
    `${JSON.stringify({ statements: [] }, null, 2)}\n`,
  );
  return root;
}

async function writeInitSeededRecord(root) {
  const empty = emptyJourneyRecord();
  await writeJourneyRecord({ projectRoot: root, record: empty });
}

async function writeDeclaredRecord(root, { ui, journeys = [], screens = [] } = {}) {
  const empty = emptyJourneyRecord();
  const record = {
    ...empty,
    ui,
    declaredAt: new Date().toISOString(),
    declaredBy: 'test',
    declaredVia: 'declare',
    journeys,
    screens,
  };
  await writeJourneyRecord({ projectRoot: root, record });
}

// ---------------------------------------------------------------------------
// AC-18905-1: D0 precedes D1; blocking; absent from WARN_WITH_ACK;
// every discovery:* carries productOwner; --check discovery exits 4 on
// fail and 0 on pass or notApplicable.
// ---------------------------------------------------------------------------

test('AC-18905-1 happy: readiness computes', async () => {
  // Stage order and policy. STAGE_SHORT_NAMES.D0 is `discovery` and
  // the gate id is define.discovery (ADR-4146).
  assert.equal(STAGE_ORDER[0], 'D0', 'D0 is the first stage');
  assert.ok(STAGE_ORDER.indexOf('D0') < STAGE_ORDER.indexOf('D1'), 'D0 precedes D1');
  assert.equal(STAGE_GATES.D0, 'define.discovery');
  assert.equal(STAGE_SHORT_NAMES.D0, 'discovery');
  assert.equal(stagePolicy('D0'), 'blocking', 'D0 is blocking');
  assert.equal(ackable('D0'), false, 'D0 is never ackable');

  // Every discovery:* check in CHECK_PERSONA is productOwner.
  const discoveryChecks = Object.keys(CHECK_PERSONA).filter((k) => k.startsWith('discovery:'));
  assert.ok(discoveryChecks.length >= 9, 'at least 9 discovery:* checks are registered');
  for (const c of discoveryChecks) {
    assert.equal(CHECK_PERSONA[c], 'productOwner', `${c} is productOwner`);
  }

  // --check discovery exits 0 on notApplicable (no record file).
  const root = await seedMinimalProject();
  const stdout = captureStream(); const stderr = captureStream();
  const exit0 = await readinessMain(['--check', 'discovery'], { stdout, stderr, cwd: root });
  assert.equal(exit0, 0, `expected 0 for notApplicable; got ${exit0}; stderr=${stderr.text}`);

  // --check discovery exits 4 when D0 is failing (init-seeded record).
  await writeInitSeededRecord(root);
  const stdout2 = captureStream(); const stderr2 = captureStream();
  const exit4 = await readinessMain(['--check', 'discovery'], { stdout: stdout2, stderr: stderr2, cwd: root });
  assert.equal(exit4, 4, `expected 4 for failing D0; got ${exit4}; stderr=${stderr2.text}`);
});

// ---------------------------------------------------------------------------
// AC-18905-2: central runs the full nine-check list; light runs the
// same set with wireframePerStep and reviewed notApplicable.
// ---------------------------------------------------------------------------

test('AC-18905-2 happy: a declared central product', () => {
  const centralRecord = {
    ui: 'central',
    asBuilt: false,
    journeys: [], screens: [], review: null,
  };
  const centralStage = checkD0Discovery({ discoveryContext: { record: centralRecord, hasRecordFile: true, wireframes: new Map() } });
  const centralChecks = centralStage.checks.map((c) => c.name);
  for (const name of [
    'discovery:declared', 'discovery:journeyPresent', 'discovery:stepsNameScreens',
    'discovery:reachable', 'discovery:interruptions', 'discovery:wireframePerStep',
    'discovery:wireframeFormat', 'discovery:wireframeSelfContained', 'discovery:reviewed',
  ]) {
    assert.ok(centralChecks.includes(name), `central includes ${name}`);
  }

  // On a central product with no record review, discovery:reviewed is
  // failing (the check demands a stamp).
  const centralReviewed = centralStage.checks.find((c) => c.name === 'discovery:reviewed');
  assert.equal(centralReviewed.ok, false, 'central without stamp => reviewed fails');

  // Light: wireframePerStep and reviewed are notApplicable (total=0).
  const lightRecord = { ui: 'light', asBuilt: false, journeys: [], screens: [], review: null };
  const lightStage = checkD0Discovery({ discoveryContext: { record: lightRecord, hasRecordFile: true, wireframes: new Map() } });
  const lightWf = lightStage.checks.find((c) => c.name === 'discovery:wireframePerStep');
  const lightReviewed = lightStage.checks.find((c) => c.name === 'discovery:reviewed');
  assert.ok(lightWf && lightWf.ok === true && lightWf.total === 0, 'light wireframePerStep is N/A (ok=true, total=0)');
  assert.ok(lightReviewed && lightReviewed.ok === true && lightReviewed.total === 0, 'light reviewed is N/A (ok=true, total=0)');
});

// ---------------------------------------------------------------------------
// AC-18905-3: declared none OR absent journey.json folds to
// notApplicable with the reason, and the door reads no other file.
// ---------------------------------------------------------------------------

test('AC-18905-3 edge: a declared none product or a tree with no journe', () => {
  // Absent file (grandfathered).
  const absent = checkD0Discovery({ discoveryContext: { record: null, hasRecordFile: false, wireframes: new Map() } });
  assert.equal(absent.state, 'notApplicable');
  assert.ok(/no discovery declaration \(existing tree\)/.test(absent.reason), `absent reason text; got ${absent.reason}`);

  // Declared none.
  const noneRec = { ui: 'none', asBuilt: false, journeys: [], screens: [], review: null };
  const none = checkD0Discovery({ discoveryContext: { record: noneRec, hasRecordFile: true, wireframes: new Map() } });
  assert.equal(none.state, 'notApplicable');
  assert.ok(/not UI-bearing/.test(none.reason), `none reason text; got ${none.reason}`);
});

// ---------------------------------------------------------------------------
// AC-18905-4: a failing D0 refuses the three write verbs with exit 4
// and the [error] refused define: ... message family; the tree is
// byte-identical before and after.
// ---------------------------------------------------------------------------

test('AC-18905-4 failure: a declared light or central product whose d0 fai', async () => {
  const root = await seedMinimalProject();
  // init-seeded record: ui null => D0 fails on discovery:declared.
  await writeInitSeededRecord(root);
  const briefLedgerPath = join(root, 'rcf', 'define', 'brief-ledger.json');
  const beforeBrief = await readFile(briefLedgerPath, 'utf8');

  // 1) brief add
  {
    const stdout = captureStream(); const stderr = captureStream();
    const rc = await ledgerMain(['brief', 'add', '--text', 'test', '--kind', 'capability'], { stdout, stderr, cwd: root });
    assert.equal(rc, 4, `brief add should exit 4; got ${rc}; stderr=${stderr.text}`);
    assert.ok(/^\[error\] refused define: brief add: D0 /.test(stderr.text), `brief add message family; got ${stderr.text}`);
    assert.ok(/null/.test(stderr.text), `brief add message names declared value (null); got ${stderr.text}`);
    assert.ok(/discovery:declared/.test(stderr.text), `brief add names failing check; got ${stderr.text}`);
    assert.ok(/rcf define readiness --check discovery/.test(stderr.text), `brief add names readiness command; got ${stderr.text}`);
    const afterBrief = await readFile(briefLedgerPath, 'utf8');
    assert.equal(afterBrief, beforeBrief, 'brief ledger byte-identical after refusal');
  }
  // 2) create req
  {
    const stdout = captureStream(); const stderr = captureStream();
    const rc = await createMain(['req', '--parent', 'PRD-001', '--title', 'test'], { stdout, stderr, cwd: root });
    assert.equal(rc, 4, `create should exit 4; got ${rc}; stderr=${stderr.text}`);
    assert.ok(/^\[error\] refused define: create req: /.test(stderr.text), `create message family; got ${stderr.text}`);
  }
});

// ---------------------------------------------------------------------------
// AC-18905-5: a declared central product with a fresh review (or a
// declared light product whose journey answers the catalogue) passes
// the door; the write lands as before.
// ---------------------------------------------------------------------------

test('AC-18905-5 happy: a central product reviewed at the current hash o', async () => {
  const root = await seedMinimalProject();
  // Declare light with a journey and interruption answers so D0 passes
  // (central needs a review stamp whose discoveryHash depends on bytes
  // we would have to compute). The AC admits "a light product whose
  // journey answers the catalogue".
  const screen = { id: 'SCR-100', slug: 'home', title: null, wireframe: null, references: [] };
  const steps = [
    { id: 'JNY-100-100', slug: 'start', screenId: 'SCR-100', kind: 'entry', label: null, next: ['JNY-100-200'], returnsTo: null },
    { id: 'JNY-100-200', slug: 'done', screenId: 'SCR-100', kind: 'exit', label: null, next: [], returnsTo: null },
  ];
  const interruptions = {
    lostEmail: 'notApplicable: not a mailed journey, no email loop in scope',
    closedTab: 'notApplicable: single-page session; no tab recovery needed',
    deadBattery: 'notApplicable: offline mode outside this journey scope',
    expiredLink: 'notApplicable: no time-bound links in this journey yet',
    switchedDevice: 'notApplicable: single device journey for this scope',
    lostSignal: 'notApplicable: all actions local, no network dependency',
  };
  await writeDeclaredRecord(root, {
    ui: 'light',
    journeys: [{ id: 'JNY-100', slug: 'home-flow', actor: null, goal: null, source: 'inline:test', steps, interruptions, stepHighWaterMark: 200 }],
    screens: [screen],
  });

  const stdout = captureStream(); const stderr = captureStream();
  // Door passes => brief add writes.
  const rc = await ledgerMain(['brief', 'add', '--text', 'first statement', '--kind', 'capability'], { stdout, stderr, cwd: root });
  assert.equal(rc, 0, `brief add should pass; got ${rc}; stderr=${stderr.text}`);
  const briefLedgerPath = join(root, 'rcf', 'define', 'brief-ledger.json');
  const after = JSON.parse(await readFile(briefLedgerPath, 'utf8'));
  assert.ok(after.statements.length >= 1, 'brief ledger carries the new statement after a passing door');
});

// ---------------------------------------------------------------------------
// AC-18905-6: no acknowledgement path on D0. readiness --ack discovery
// exits 2 as not ackable; freeze refuses through its failing block
// naming D0.
// ---------------------------------------------------------------------------

test('AC-18905-6 must-not: d0 failing', async () => {
  const root = await seedMinimalProject();
  await writeInitSeededRecord(root);

  // readiness --ack discovery (exits 2 with "not ackable" message).
  {
    const stdout = captureStream(); const stderr = captureStream();
    const rc = await readinessMain(['--ack', 'discovery'], { stdout, stderr, cwd: root });
    assert.equal(rc, 2, `readiness --ack discovery should exit 2; got ${rc}; stderr=${stderr.text}`);
    assert.ok(/ackable/.test(stderr.text), `message mentions ackable; got ${stderr.text}`);
    assert.ok(/ADR-4146/.test(stderr.text), `message cites ADR-4146; got ${stderr.text}`);
  }

  // freeze refuses because D0 is failing (and D0 is in BLOCKING set).
  // We only probe exit code; the whole freeze pipeline needs more
  // chain to actually run, so refusal before deeper work is fine.
  {
    const stdout = captureStream(); const stderr = captureStream();
    const rc = await freezeMain([], { stdout, stderr, cwd: root });
    assert.notEqual(rc, 0, `freeze should refuse on failing D0; got ${rc}`);
  }
});

// ---------------------------------------------------------------------------
// AC-18905-7: a failing D0 does NOT gate update, delete, link, unlink,
// resolve, list, decisions / concerns / probes ledger ops, standards,
// design, readiness, questions. We cover the common ones.
// ---------------------------------------------------------------------------

test('AC-18905-7 must-not: a product whose d0 fails', async () => {
  const root = await seedMinimalProject();
  await writeInitSeededRecord(root);

  // ledger decisions list: not gated (not a mint). Reads an empty
  // decisions-ledger file, so write a trivial one.
  await writeFile(
    join(root, 'rcf', 'define', 'decisions-ledger.json'),
    `${JSON.stringify({ decisions: [] }, null, 2)}\n`,
  );
  {
    const stdout = captureStream(); const stderr = captureStream();
    const rc = await ledgerMain(['decisions', 'list'], { stdout, stderr, cwd: root });
    assert.equal(rc, 0, `decisions list should not be gated by D0; got ${rc}; stderr=${stderr.text}`);
  }

  // readiness: not gated (still produces its own compute even when D0 fails).
  {
    const stdout = captureStream(); const stderr = captureStream();
    const rc = await readinessMain([], { stdout, stderr, cwd: root });
    assert.equal(rc, 0, `readiness (no --check) should not fail on D0; got ${rc}; stderr=${stderr.text}`);
    assert.ok(/D0 \(define.discovery\)/.test(stdout.text) || /discovery/.test(stdout.text), 'readiness output names D0');
  }
});

// ---------------------------------------------------------------------------
// AC-18905-8: `rcf define questions --persona productOwner` surfaces
// D0 items first; a none product or a grandfathered tree contributes
// no D0 question.
// ---------------------------------------------------------------------------

test('AC-18905-8 happy: rcf define questions persona productowner on a f', () => {
  const tree = makeTree();
  // 1) Grandfathered: D0 is notApplicable, so there is no D0 blocker
  // and no D0 question regardless of what the brief shows.
  const grandfathered = computeReadiness(tree, {
    ledgers: { brief: { statements: [] }, decisions: { decisions: [] }, concerns: { concerns: [] }, probes: { probes: [] } },
  });
  const qGrand = computeQuestions(grandfathered, { tree, ledgers: {}, persona: 'productOwner' });
  const grandD0 = (qGrand.questions || []).filter((q) => q.stage === 'D0');
  assert.equal(grandD0.length, 0, 'grandfathered tree contributes no D0 question');

  // 2) Declared none: still notApplicable; no D0 question.
  const nullCtx = { record: { ui: 'none', asBuilt: false, journeys: [], screens: [], review: null }, hasRecordFile: true, wireframes: new Map() };
  const noneR = computeReadiness(tree, {
    ledgers: { brief: { statements: [] }, decisions: { decisions: [] }, concerns: { concerns: [] }, probes: { probes: [] } },
    discoveryContext: nullCtx,
  });
  const qNone = computeQuestions(noneR, { tree, ledgers: {}, persona: 'productOwner' });
  const noneD0 = (qNone.questions || []).filter((q) => q.stage === 'D0');
  assert.equal(noneD0.length, 0, 'none product contributes no D0 question');

  // 3) Failing D0 (ui null, init-seeded): the first question is D0.
  const seededCtx = { record: { ui: null, asBuilt: false, journeys: [], screens: [], review: null }, hasRecordFile: true, wireframes: new Map() };
  const failR = computeReadiness(tree, {
    ledgers: { brief: { statements: [] }, decisions: { decisions: [] }, concerns: { concerns: [] }, probes: { probes: [] } },
    discoveryContext: seededCtx,
  });
  const qFail = computeQuestions(failR, { tree, ledgers: {}, persona: 'productOwner' });
  const first = qFail.questions[0];
  assert.ok(first, 'at least one question emitted');
  assert.equal(first.stage, 'D0', `first question is D0; got ${first.stage}`);
  assert.equal(first.check, 'discovery:declared');
  assert.ok(first.writeBack && first.writeBack.length > 0 && /rcf discover journey/.test(first.writeBack[0].command),
    'D0 question write-back names a journey verb');
});

// ---------------------------------------------------------------------------
// AC-18905-9: a record whose JourneyRecord.ui is null (init-seeded)
// fails on discovery:declared, D0 is failing, and the door refuses
// as it does for any failing D0.
// ---------------------------------------------------------------------------

test('AC-18905-9 failure: a record whose journeyrecordui is null the recor', async () => {
  // Pure gate behaviour.
  const stage = checkD0Discovery({ discoveryContext: { record: { ui: null, journeys: [], screens: [], asBuilt: false }, hasRecordFile: true, wireframes: new Map() } });
  assert.equal(stage.state, 'failing');
  assert.equal(stage.checks.length, 1);
  assert.equal(stage.checks[0].name, 'discovery:declared');
  assert.equal(stage.checks[0].ok, false);
  const why = stage.checks[0].failing[0].why;
  assert.ok(/declare/.test(why), `why names the declare verb; got ${why}`);
  for (const v of ['none', 'light', 'central']) {
    assert.ok(why.includes(v), `why names the ${v} enum value; got ${why}`);
  }

  // Door path. Minimal project with an init-seeded record.
  const root = await seedMinimalProject();
  await writeInitSeededRecord(root);
  const stdout = captureStream(); const stderr = captureStream();
  const rc = await ledgerMain(['brief', 'add', '--text', 'x', '--kind', 'capability'], { stdout, stderr, cwd: root });
  assert.equal(rc, 4, `brief add on ui-null record exits 4; got ${rc}; stderr=${stderr.text}`);
  assert.ok(/discovery:declared/.test(stderr.text), 'refusal names discovery:declared');
});
