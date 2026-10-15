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
import { main as blueprintMain } from '../../src/cli/blueprint.js';
import { main as updateMain } from '../../src/cli/update.js';
import { main as deleteMain } from '../../src/cli/delete.js';
import { main as linkMain } from '../../src/cli/link.js';
import { main as questionsMain } from '../../src/cli/questions.js';
import { loadDiscoveryContext } from '../../src/discovery/context.js';
import { writeJourneyRecord, emptyJourneyRecord } from '../../src/discovery/record.js';
import { initProject } from '../../src/core/store/init.js';
import { scratchDir } from '../_helpers/scratch.js';

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
  const dir = await scratchDir('rcf-fbs-214-');
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

async function seedFullProject() {
  // A full init-shaped project so `rcf define create req --parent PRD-001`
  // resolves PRD-001 against a schema-valid root. The scaffold seeds a
  // ui-null journey record (ADR-4145); callers overwrite that for the
  // D0 posture they want.
  const dir = await scratchDir('rcf-fbs-214-full-');
  const root = await realpath(dir);
  await initProject({ projectRoot: root, projectName: 'FBS-214 test project', seed: null });
  // Seed an empty brief ledger explicitly - initProject does not
  // create one, and the ledger CLI needs the file to append to.
  await mkdir(join(root, 'rcf', 'define'), { recursive: true });
  const briefLedger = join(root, 'rcf', 'define', 'brief-ledger.json');
  try { await readFile(briefLedger, 'utf8'); }
  catch { await writeFile(briefLedger, `${JSON.stringify({ statements: [] }, null, 2)}\n`); }
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

// AC-18905-3 (loader read-set): the file reader for a declared none
// product (or an absent file) must NOT read any wireframe bytes.
// Prove it by placing a wireframe path on disk that the loader
// WOULD read on a central product, declaring none, and confirming
// the loaded context's wireframes map stays empty.
test('AC-18905-3 edge: loader reads NO wireframe bytes on the none path', async () => {
  const root = await seedMinimalProject();
  await mkdir(join(root, 'rcf', 'discovery', 'wireframes'), { recursive: true });
  // Place a would-be-wireframe file; if the loader were reading it we
  // would see it in the wireframes map on a declared record.
  await writeFile(join(root, 'rcf', 'discovery', 'wireframes', 'home.md'), '# wireframe\n');
  // Declare NONE: the loader must short-circuit before any wireframe
  // path on the record is touched. The screen below carries a
  // wireframe path; the loader must not resolve it on the none path.
  await writeDeclaredRecord(root, {
    ui: 'none',
    journeys: [],
    screens: [{ id: 'SCR-100', slug: 'home', title: null, wireframe: 'rcf/discovery/wireframes/home.md', references: [] }],
  });
  const ctx = await loadDiscoveryContext({ projectRoot: root });
  assert.equal(ctx.hasRecordFile, true, 'record was declared, so hasRecordFile is true');
  assert.equal(ctx.wireframes.size, 0, 'none path reads no wireframe bytes');

  // Grandfathered (absent file): empty wireframes map and
  // hasRecordFile false.
  const freshRoot = await seedMinimalProject();
  const ctxAbsent = await loadDiscoveryContext({ projectRoot: freshRoot });
  assert.equal(ctxAbsent.hasRecordFile, false, 'absent file => hasRecordFile false');
  assert.equal(ctxAbsent.wireframes.size, 0, 'absent file reads no wireframe bytes');
});

// AC-18905-3 (F1 regression): a malformed, schema-invalid or
// out-of-enum record is NOT grandfathered. The context reports
// invalidRecord, D0 fails on discovery:declared and the door
// refuses with exit 4.
test('AC-18905-3 F1: a malformed journey.json fails D0, door refuses (not grandfathered)', async () => {
  for (const payload of ['{not json', '', '{"version":1,"ui":"CENTRAL"}', '{"version":1,"ui":null,"stray":true}']) {
    const root = await seedMinimalProject();
    await mkdir(join(root, 'rcf', 'discovery'), { recursive: true });
    await writeFile(join(root, 'rcf', 'discovery', 'journey.json'), payload);
    const ctx = await loadDiscoveryContext({ projectRoot: root });
    assert.ok(ctx.invalidRecord instanceof Error, `payload ${JSON.stringify(payload).slice(0,30)}: ctx.invalidRecord is set`);
    const stage = checkD0Discovery({ discoveryContext: ctx });
    assert.equal(stage.state, 'failing', 'D0 fails on an invalid record');
    const d = stage.checks.find((c) => c.name === 'discovery:declared');
    assert.ok(d && d.ok === false, 'discovery:declared fails');
    // Door path: brief add refuses.
    const stdout = captureStream(); const stderr = captureStream();
    const briefLedgerPath = join(root, 'rcf', 'define', 'brief-ledger.json');
    const before = await readFile(briefLedgerPath, 'utf8');
    const rc = await ledgerMain(['brief', 'add', '--text', 't', '--kind', 'capability'], { stdout, stderr, cwd: root });
    assert.equal(rc, 4, `malformed/invalid record: brief add refuses with exit 4; got ${rc}; stderr=${stderr.text}`);
    const after = await readFile(briefLedgerPath, 'utf8');
    assert.equal(after, before, 'brief ledger byte-identical after refusal on invalid record');
  }
});

// ---------------------------------------------------------------------------
// AC-18905-4: a failing D0 refuses the three write verbs with exit 4
// and the [error] refused define: ... message family; the tree is
// byte-identical before and after.
// ---------------------------------------------------------------------------

// AC-18905-4: ui-null AND light AND central with a failing discovery
// all refuse the three write verbs with exit 4; tree is byte-identical;
// refusal names failing ids. TAC-4142 shape: "this product is declared
// <light|central> but DISCOVERY is not complete." (null variant swaps
// in "the discovery journey record is not declared").
test('AC-18905-4 failure: a declared light or central product whose d0 fai', async () => {
  /** @type {Array<{ label: string, declareWriter: (root: string) => Promise<void>, declaredRe: RegExp }>} */
  const cases = [
    {
      label: 'ui-null (init-seeded)',
      declareWriter: writeInitSeededRecord,
      declaredRe: /the discovery journey record is not declared/,
    },
    {
      label: 'ui-light (no journey authored)',
      declareWriter: async (root) => { await writeDeclaredRecord(root, { ui: 'light' }); },
      declaredRe: /this product is declared light but DISCOVERY is not complete/,
    },
    {
      label: 'ui-central (no journey authored)',
      declareWriter: async (root) => { await writeDeclaredRecord(root, { ui: 'central' }); },
      declaredRe: /this product is declared central but DISCOVERY is not complete/,
    },
  ];

  for (const c of cases) {
    // Use the init-scaffolded project so the blueprint CLI's pre-add
    // walkTree does not short-circuit on manifest validation; the
    // writer still runs the D0 door before resolving the source.
    const root = await seedFullProject();
    await c.declareWriter(root);

    const briefLedgerPath = join(root, 'rcf', 'define', 'brief-ledger.json');
    const beforeBrief = await readFile(briefLedgerPath, 'utf8');

    // 1) brief add
    {
      const stdout = captureStream(); const stderr = captureStream();
      const rc = await ledgerMain(['brief', 'add', '--text', 'test', '--kind', 'capability'], { stdout, stderr, cwd: root });
      assert.equal(rc, 4, `${c.label}: brief add exit 4; got ${rc}; stderr=${stderr.text}`);
      assert.ok(/^\[error\] refused define: brief add: /.test(stderr.text), `${c.label}: brief add message family`);
      assert.ok(c.declaredRe.test(stderr.text), `${c.label}: brief add names declared posture; got ${stderr.text}`);
      assert.ok(/D0 \(define.discovery\) is failing on/.test(stderr.text), `${c.label}: brief add names D0`);
      assert.ok(/\[rcf\/discovery\/journey.json\]/.test(stderr.text) || /\[JNY-/.test(stderr.text), `${c.label}: brief add names failing ids; got ${stderr.text}`);
      assert.ok(/rcf define readiness --check discovery/.test(stderr.text), `${c.label}: brief add names readiness command`);
      const afterBrief = await readFile(briefLedgerPath, 'utf8');
      assert.equal(afterBrief, beforeBrief, `${c.label}: brief ledger byte-identical after refusal`);
    }
    // 2) create req: assert byte-identity of the PRD and the whole rcf/requirements/ tree
    {
      const prdPath = join(root, 'rcf', 'prd.json');
      const beforePrd = await readFile(prdPath, 'utf8');
      const beforeReqs = await (async () => {
        try { return (await readFile(join(root, 'rcf', 'requirements', 'req-001.json'), 'utf8')); } catch { return null; }
      })();
      const stdout = captureStream(); const stderr = captureStream();
      const rc = await createMain(['req', '--parent', 'PRD-001', '--title', 'test'], { stdout, stderr, cwd: root });
      assert.equal(rc, 4, `${c.label}: create req exit 4; got ${rc}; stderr=${stderr.text}`);
      assert.ok(/^\[error\] refused define: create req: /.test(stderr.text), `${c.label}: create message family`);
      assert.ok(c.declaredRe.test(stderr.text), `${c.label}: create names declared posture`);
      const afterPrd = await readFile(prdPath, 'utf8');
      assert.equal(afterPrd, beforePrd, `${c.label}: prd.json byte-identical after create refusal`);
      let afterReqs = null;
      try { afterReqs = await readFile(join(root, 'rcf', 'requirements', 'req-001.json'), 'utf8'); } catch {}
      assert.equal(afterReqs, beforeReqs, `${c.label}: no new requirement file minted on refusal`);
    }
    // 3) blueprint add: refuses before resolving the source
    {
      const stdout = captureStream(); const stderr = captureStream();
      const rc = await blueprintMain(['add', 'nonexistent-source.md'], { stdout, stderr, cwd: root });
      assert.equal(rc, 4, `${c.label}: blueprint add exit 4; got ${rc}; stderr=${stderr.text}`);
      assert.ok(/^\[error\] refused define: blueprint add: /.test(stderr.text), `${c.label}: blueprint add message family`);
      assert.ok(c.declaredRe.test(stderr.text), `${c.label}: blueprint add names declared posture`);
    }
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

  // Light passes the door for create too (mint a REQ under PRD-001).
  // We use the full-shape (init-scaffolded) project so the walker
  // resolves PRD-001 against a schema-valid root, overwritten with
  // a declared-light journey record.
  const fullRoot = await seedFullProject();
  await writeDeclaredRecord(fullRoot, {
    ui: 'light',
    journeys: [{ id: 'JNY-100', slug: 'home-flow', actor: null, goal: null, source: 'inline:test', steps, interruptions, stepHighWaterMark: 200 }],
    screens: [screen],
  });
  {
    const so = captureStream(); const se = captureStream();
    const rcCreate = await createMain(['req', '--parent', 'PRD-001', '--title', 'light pass'], { stdout: so, stderr: se, cwd: fullRoot });
    assert.equal(rcCreate, 0, `light: create req passes door; got ${rcCreate}; stderr=${se.text}`);
    assert.ok(!/refused define/.test(se.text), 'light: create must not carry refusal shape');
  }
});

// AC-18905-5 positive (declared none): the grandfather-adjacent fold -
// a declared `none` product passes the door for all three verbs.
test('AC-18905-5 happy: a declared none product passes the door', async () => {
  // brief add via minimal (fast) project
  {
    const root = await seedMinimalProject();
    await writeDeclaredRecord(root, { ui: 'none' });
    const so = captureStream(); const se = captureStream();
    const rc = await ledgerMain(['brief', 'add', '--text', 'none-pass', '--kind', 'capability'], { stdout: so, stderr: se, cwd: root });
    assert.equal(rc, 0, `none: brief add passes; got ${rc}; stderr=${se.text}`);
  }
  // create via full-shape (init-scaffolded) project so PRD-001 resolves
  {
    const root = await seedFullProject();
    await writeDeclaredRecord(root, { ui: 'none' });
    const so = captureStream(); const se = captureStream();
    const rc = await createMain(['req', '--parent', 'PRD-001', '--title', 'none pass'], { stdout: so, stderr: se, cwd: root });
    assert.equal(rc, 0, `none: create passes; got ${rc}; stderr=${se.text}`);
    assert.ok(!/refused define/.test(se.text), 'none: create must not carry refusal shape');
  }
  // blueprint add (source missing => exit 2 after door passed; NOT 4)
  {
    const root = await seedMinimalProject();
    await writeDeclaredRecord(root, { ui: 'none' });
    const so = captureStream(); const se = captureStream();
    const rc = await blueprintMain(['add', 'nonexistent-source.md'], { stdout: so, stderr: se, cwd: root });
    assert.notEqual(rc, 4, `none: blueprint add passes the door (exit != 4); got ${rc}; stderr=${se.text}`);
    assert.ok(!/refused define/.test(se.text), 'none: blueprint add refusal shape must not appear');
  }
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

  // freeze refuses with exit 4 (D0 in BLOCKING set). The printed
  // failing block must name D0 (define.discovery), not only D1..D8.
  {
    const stdout = captureStream(); const stderr = captureStream();
    const rc = await freezeMain([], { stdout, stderr, cwd: root });
    assert.equal(rc, 4, `freeze should exit 4 on failing D0; got ${rc}; stderr=${stderr.text}`);
    const combined = stdout.text + stderr.text;
    assert.ok(/D0\s*\(define\.discovery\)/.test(combined), `freeze failing block names D0; got ${combined}`);
    assert.ok(/discovery:declared/.test(combined), `freeze failing block names the failing check; got ${combined}`);
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

  // AC-7: update, delete and link are NOT door-gated. They touch
  // existing records and must proceed even on a failing D0. Seed a
  // minimal pre-existing req so update/delete have a target.
  await mkdir(join(root, 'rcf', 'requirements'), { recursive: true });
  await writeFile(
    join(root, 'rcf', 'requirements', 'req-001.json'),
    `${JSON.stringify({ reqId: 'REQ-001', prdId: 'PRD-001', title: 'seed', description: 'seed', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: 'draft', version: '0.1.0', domain: 'test' }, null, 2)}\n`,
  );
  // update: not gated
  {
    const stdout = captureStream(); const stderr = captureStream();
    const rc = await updateMain(['REQ-001', '--set', 'title=renamed'], { stdout, stderr, cwd: root });
    assert.notEqual(rc, 4, `update is NOT door-gated; got ${rc}; stderr=${stderr.text}`);
    assert.ok(!/refused define/.test(stderr.text), 'update must not carry refusal shape on failing D0');
  }
  // delete --dry-run: not gated (we use dry-run so we leave the file for the link test below)
  {
    const stdout = captureStream(); const stderr = captureStream();
    const rc = await deleteMain(['REQ-001', '--dry-run', '--cascade'], { stdout, stderr, cwd: root });
    assert.notEqual(rc, 4, `delete is NOT door-gated; got ${rc}; stderr=${stderr.text}`);
    assert.ok(!/refused define/.test(stderr.text), 'delete must not carry refusal shape on failing D0');
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

// AC-18905-8 (through the CLI): the shipped `rcf define questions`
// verb must thread discoveryContext, so a failing D0 tree surfaces
// a D0 item from the questions CLI (not just from the pure compose).
test('AC-18905-8 happy: `rcf define questions --persona productOwner` surfaces D0 first', async () => {
  const root = await seedMinimalProject();
  await writeInitSeededRecord(root);
  const stdout = captureStream(); const stderr = captureStream();
  const rc = await questionsMain(['--persona', 'productOwner', '--json'], { stdout, stderr, cwd: root });
  assert.equal(rc, 0, `questions CLI exits 0; got ${rc}; stderr=${stderr.text}`);
  const envelope = JSON.parse(stdout.text);
  assert.ok(Array.isArray(envelope.questions), 'questions is an array');
  const d0 = envelope.questions.filter((q) => q.stage === 'D0');
  assert.ok(d0.length >= 1, `at least one D0 question on a failing D0 tree; got ${d0.length}`);
  const first = envelope.questions[0];
  assert.equal(first.stage, 'D0', `first question is D0; got ${first.stage}`);
  assert.equal(first.check, 'discovery:declared');
  // F4: the write-back must name a journey verb WITH the real flag
  // set (--from <path>, --ui <...>, --by <name>). No invented flags.
  const command = first.writeBack[0].command;
  assert.ok(/rcf discover journey/.test(command), `write-back names a journey verb; got ${command}`);
  assert.ok(!/--journey\b/.test(command) && !/--step\b/.test(command) && !/--kind\b/.test(command) && !/--screen\b/.test(command) && !/--wireframe\b/.test(command) && !/--interruption\b/.test(command) && !/--answer\b/.test(command) && !/--interruptions\b/.test(command),
    `write-back must not name invented flags; got ${command}`);
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
