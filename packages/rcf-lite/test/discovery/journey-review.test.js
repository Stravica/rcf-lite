// REQ-189 US-18904 (UX intake gate): five real tests binding the
// acceptance criteria of US-18904 to the FBS-213 implementation
// (discoveryHash from src/discovery/hash.js, the discovery:reviewed
// check added to src/discovery/check.js, the `rcf discover journey
// review` sub-verb, and the managed agent-instructions block that
// carries the journey-review rule beside the ADR-4132 prototype
// rule). Each AC test name is kept verbatim from the DEFINE
// declaration so the testPointer on TC-246-18904-* resolves
// unchanged.
//
// Shape of the suite: pure calls on hand-authored records exercise
// the invariants directly; the CLI verb is spawned end-to-end for
// the AC-18904-1 (stamp shape and one-line summary), AC-18904-3
// (refusal exit code and absent-stamp invariant) and AC-18904-5
// (managed-block rule) cases where the stamp body, the exit code
// and the file bytes are the contract.
// Node 24 built-ins only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

import { initProject } from '#core/store/init.js';

import {
  INTERRUPTION_CATALOGUE_V1,
  checkDiscovery,
} from '../../src/discovery/check.js';
import {
  discoveryHash,
  fileSha256,
} from '../../src/discovery/hash.js';
import {
  JourneyRecordError,
  emptyJourneyRecord,
  readJourneyRecord,
  writeJourneyRecord,
} from '../../src/discovery/record.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const BIN = resolve(repoRoot, 'bin', 'rcf.js');

function mkProject() {
  return mkdtempSync(join(tmpdir(), 'rcf-journey-fbs213-'));
}

async function setupProject(scratch) {
  await initProject({ projectRoot: scratch, projectName: 'FBS-213 Scratch' });
  const dir = join(scratch, 'rcf', 'discovery', 'wireframes');
  await mkdir(dir, { recursive: true });
  return dir;
}

function runCli(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' },
  });
}

/**
 * Build a complete JourneyRecord with one journey, two screens and
 * the six interruption answers set to notApplicable with reasons
 * long enough to pass the reason-body floor. Suitable for every
 * structural check to pass on a central product with wireframes.
 */
function completeRecord({ ui = 'central', asBuilt = false, wireframes = {} } = {}) {
  const base = emptyJourneyRecord();
  base.ui = ui;
  base.declaredAt = '2026-10-10T00:00:00.000Z';
  base.declaredBy = 'test';
  base.declaredVia = 'declare';
  base.asBuilt = asBuilt;
  base.screens = [
    {
      id: 'SCR-001', slug: 'home', title: null,
      wireframe: wireframes.home ?? null, references: [],
    },
    {
      id: 'SCR-002', slug: 'done', title: null,
      wireframe: wireframes.done ?? null, references: [],
    },
  ];
  base.journeys = [{
    id: 'JNY-001', slug: 'signup', actor: null, goal: null,
    source: 'rcf/discovery/journeys/signup.journey.md',
    steps: [
      {
        id: 'JNY-001-001', slug: 'start', kind: 'entry',
        screenId: 'SCR-001', label: null, next: ['JNY-001-002'], returnsTo: null,
      },
      {
        id: 'JNY-001-002', slug: 'finish', kind: 'exit',
        screenId: 'SCR-002', label: null, next: [], returnsTo: null,
      },
    ],
    stepHighWaterMark: 2,
    interruptions: Object.fromEntries(
      INTERRUPTION_CATALOGUE_V1.map((entry) => [
        entry, 'notApplicable:out of scope for this canonical test fixture',
      ]),
    ),
  }];
  return base;
}

test('AC-18904-1 happy: a journey that passes every structural check', async () => {
  // A central record with two wireframes passes every structural
  // check. The review verb writes a ReviewStamp whose shape matches
  // the AC: state 'reviewed', by equal to the name, at.time + at.hash
  // (the discoveryHash of the record WITHOUT the review field joined
  // with sorted (path, sha256) pairs), and wireframeHashes carrying
  // one sha256 per screen with a wireframe.
  const record = completeRecord({ ui: 'central', wireframes: {
    home: 'rcf/discovery/wireframes/home.md',
    done: 'rcf/discovery/wireframes/done.md',
  } });
  const scratch = mkProject();
  const dir = await setupProject(scratch);
  const homeBytes = Buffer.from('# home\n', 'utf8');
  const doneBytes = Buffer.from('# done\n', 'utf8');
  await writeFile(join(dir, 'home.md'), homeBytes);
  await writeFile(join(dir, 'done.md'), doneBytes);
  await writeJourneyRecord({ projectRoot: scratch, record });

  const r = runCli(['discover', 'journey', 'review', '--by', 'Reviewer One'], scratch);
  assert.equal(r.status, 0, `stdout=${r.stdout}\nstderr=${r.stderr}`);
  // One-line summary printed before the body of the stamp (AC-18904-2
  // is proven elsewhere; here we confirm the summary IS printed).
  assert.ok(/\[ok\] discovery review:.*1 journey,.*2 steps,.*2 screens,.*0 interruptions mapped/.test(r.stdout), `summary line not present: ${r.stdout}`);

  const stamped = await readJourneyRecord(scratch);
  const stamp = stamped.review;
  assert.ok(stamp, 'review stamp must be written on a pass');
  assert.equal(stamp.state, 'reviewed');
  assert.equal(stamp.by, 'Reviewer One');
  assert.equal(typeof stamp.at, 'object');
  assert.equal(typeof stamp.at.time, 'string');
  // at.time must parse as an ISO date and sit in the recent past.
  const stampedAt = Date.parse(stamp.at.time);
  assert.ok(Number.isFinite(stampedAt), `at.time must parse as a date: ${stamp.at.time}`);
  assert.ok(Math.abs(Date.now() - stampedAt) < 60_000, 'at.time must be the recent clock');

  // at.hash must equal the discoveryHash the AC names: the record
  // WITHOUT review joined with sorted (path, sha256) pairs.
  const expectedPairs = [
    { path: 'rcf/discovery/wireframes/done.md', sha256: fileSha256(doneBytes) },
    { path: 'rcf/discovery/wireframes/home.md', sha256: fileSha256(homeBytes) },
  ];
  const expectedHash = discoveryHash(record, expectedPairs);
  assert.equal(stamp.at.hash, expectedHash, 'at.hash must equal discoveryHash(record without review, sorted wireframe pairs)');

  // wireframeHashes carries one entry per screen with a wireframe.
  assert.deepEqual(
    Object.keys(stamp.wireframeHashes).sort(),
    ['rcf/discovery/wireframes/done.md', 'rcf/discovery/wireframes/home.md'],
  );
  assert.equal(stamp.wireframeHashes['rcf/discovery/wireframes/home.md'], fileSha256(homeBytes));
  assert.equal(stamp.wireframeHashes['rcf/discovery/wireframes/done.md'], fileSha256(doneBytes));
});

test('AC-18904-2 happy: a reviewed record', async () => {
  // Given a reviewed record, discovery:reviewed passes when every
  // wireframe file is unchanged, AND the review verb that produced
  // the stamp printed the one-line summary (journeys, steps, screens,
  // interruptions mapped) before writing.
  const record = completeRecord({ ui: 'central', wireframes: {
    home: 'rcf/discovery/wireframes/home.md',
    done: 'rcf/discovery/wireframes/done.md',
  } });
  // Map one interruption to a step so the summary's mapped count is
  // non-zero and distinguishable from a notApplicable catalogue.
  record.journeys[0].interruptions.lostEmail = 'JNY-001-002';
  const scratch = mkProject();
  const dir = await setupProject(scratch);
  await writeFile(join(dir, 'home.md'), '# home\n', 'utf8');
  await writeFile(join(dir, 'done.md'), '# done\n', 'utf8');
  await writeJourneyRecord({ projectRoot: scratch, record });

  const r = runCli(['discover', 'journey', 'review', '--by', 'Reviewer One'], scratch);
  assert.equal(r.status, 0, `stdout=${r.stdout}\nstderr=${r.stderr}`);
  // The summary line names the four counts in order and precedes the
  // stamp-detail lines (byte-wise, 'review:' appears before 'stamped
  // by:' in stdout).
  const summaryIdx = r.stdout.indexOf('discovery review:');
  const stampedByIdx = r.stdout.indexOf('stamped by:');
  assert.ok(summaryIdx >= 0 && stampedByIdx > summaryIdx, `summary must come before 'stamped by' line: ${r.stdout}`);
  assert.match(r.stdout, /1 journey,/);
  assert.match(r.stdout, /2 steps,/);
  assert.match(r.stdout, /2 screens,/);
  assert.match(r.stdout, /1 interruption mapped/);

  // Pure-check path: discovery:reviewed is 'pass' on the live record
  // + current wireframe bytes.
  const stamped = await readJourneyRecord(scratch);
  const homeBytes = await readFile(join(dir, 'home.md'));
  const doneBytes = await readFile(join(dir, 'done.md'));
  const wireframes = new Map([
    ['rcf/discovery/wireframes/home.md', { bytes: homeBytes }],
    ['rcf/discovery/wireframes/done.md', { bytes: doneBytes }],
  ]);
  const results = checkDiscovery({ record: stamped, ui: stamped.ui, wireframes });
  const reviewed = results.find((x) => x.id === 'discovery:reviewed');
  assert.ok(reviewed, 'discovery:reviewed must be present in the check list');
  assert.equal(reviewed.state, 'pass', `discovery:reviewed must pass on an unchanged tree, got ${reviewed.state} (${reviewed.why})`);

  // Verb-level: a fresh `check` run on the stamped tree exits 0 and
  // the discovery:reviewed line reads ok.
  const r2 = runCli(['discover', 'journey', 'check'], scratch);
  assert.equal(r2.status, 0, `check must exit 0 on reviewed-and-unchanged: ${r2.stdout}\n${r2.stderr}`);
  assert.match(r2.stdout, /\[ok\] discovery:reviewed/);
});

test('AC-18904-3 failure: a journey that fails any structural check', async () => {
  // Given a journey that fails any structural check, the review verb
  // exits 4, prints the failing checks and writes no ReviewStamp. We
  // exercise two independent failure modes to prove the refusal is
  // not keyed to one check:
  //
  //   - an unmapped interruption (discovery:interruptions failure)
  //   - a central product with a missing wireframe path on disk
  //     (discovery:wireframePerStep failure)
  for (const scenario of ['missing-interruption', 'missing-wireframe-file']) {
    const record = completeRecord({ ui: 'central', wireframes: {
      home: 'rcf/discovery/wireframes/home.md',
      done: 'rcf/discovery/wireframes/done.md',
    } });
    if (scenario === 'missing-interruption') {
      // Blank an interruption so the catalogue is incomplete.
      delete record.journeys[0].interruptions.lostEmail;
    }
    const scratch = mkProject();
    const dir = await setupProject(scratch);
    await writeFile(join(dir, 'home.md'), '# home\n', 'utf8');
    if (scenario !== 'missing-wireframe-file') {
      await writeFile(join(dir, 'done.md'), '# done\n', 'utf8');
    }
    await writeJourneyRecord({ projectRoot: scratch, record });

    const r = runCli(['discover', 'journey', 'review', '--by', 'Reviewer One'], scratch);
    assert.equal(r.status, 4, `scenario=${scenario} must exit 4: ${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /\[refused\] journey review refused/);
    // No ReviewStamp lands on the disk when the verb refuses.
    const read = await readJourneyRecord(scratch);
    assert.equal(read.review, null, `scenario=${scenario}: review.review must stay null on refusal`);
  }
});

test('AC-18904-4 edge: a reviewed record', async () => {
  // Given a reviewed record, when a wireframe file's bytes change OR
  // a journey source is re-minted, discovery:reviewed fails as stale
  // with a why naming the changed screens or journey. A second review
  // at the new hash makes it pass again.
  const record = completeRecord({ ui: 'central', wireframes: {
    home: 'rcf/discovery/wireframes/home.md',
    done: 'rcf/discovery/wireframes/done.md',
  } });
  const scratch = mkProject();
  const dir = await setupProject(scratch);
  await writeFile(join(dir, 'home.md'), '# home\n', 'utf8');
  await writeFile(join(dir, 'done.md'), '# done\n', 'utf8');
  await writeJourneyRecord({ projectRoot: scratch, record });

  // First review passes.
  const r1 = runCli(['discover', 'journey', 'review', '--by', 'Reviewer One'], scratch);
  assert.equal(r1.status, 0, `first review must pass: ${r1.stdout}\n${r1.stderr}`);

  // --- Branch 1: a wireframe file's bytes change. ---
  await writeFile(join(dir, 'home.md'), '# home (edited)\n', 'utf8');
  const stamped = await readJourneyRecord(scratch);
  const homeBytes = await readFile(join(dir, 'home.md'));
  const doneBytes = await readFile(join(dir, 'done.md'));
  const wireframes = new Map([
    ['rcf/discovery/wireframes/home.md', { bytes: homeBytes }],
    ['rcf/discovery/wireframes/done.md', { bytes: doneBytes }],
  ]);
  const r1Results = checkDiscovery({ record: stamped, ui: stamped.ui, wireframes });
  const reviewed = r1Results.find((x) => x.id === 'discovery:reviewed');
  assert.equal(reviewed.state, 'fail', 'wireframe bytes change must fail discovery:reviewed');
  assert.ok(/wireframe bytes changed/.test(reviewed.why), `why must name the wireframe-byte branch: ${reviewed.why}`);
  assert.ok(reviewed.failingIds.includes('rcf/discovery/wireframes/home.md'), `failingIds must name the changed screen: ${JSON.stringify(reviewed.failingIds)}`);
  // The check verb exit code picks up the stale stamp.
  const rCheck = runCli(['discover', 'journey', 'check'], scratch);
  assert.equal(rCheck.status, 4, `check must exit 4 on a stale stamp: ${rCheck.stdout}`);

  // A second review at the new hash makes it pass again.
  const r2 = runCli(['discover', 'journey', 'review', '--by', 'Reviewer One'], scratch);
  assert.equal(r2.status, 0, `second review on the new bytes must pass: ${r2.stdout}\n${r2.stderr}`);
  const r2Check = runCli(['discover', 'journey', 'check'], scratch);
  assert.equal(r2Check.status, 0, `check must exit 0 after re-review: ${r2Check.stdout}`);

  // --- Branch 2: a journey source is re-minted (record body
  // changes without wireframe bytes changing). We simulate a re-mint
  // by rewriting the journey's source path, which is part of the
  // canonical body hashed into discoveryHash. The per-wireframe
  // hashes stay identical, so the branch MUST report the record-
  // body re-mint distinctly from the wireframe-bytes branch.
  const nowStamped = await readJourneyRecord(scratch);
  nowStamped.journeys[0].source = 'rcf/discovery/journeys/signup-v2.journey.md';
  await writeJourneyRecord({ projectRoot: scratch, record: nowStamped });

  const r3Record = await readJourneyRecord(scratch);
  const wireframesUnchanged = new Map([
    ['rcf/discovery/wireframes/home.md', { bytes: await readFile(join(dir, 'home.md')) }],
    ['rcf/discovery/wireframes/done.md', { bytes: await readFile(join(dir, 'done.md')) }],
  ]);
  const r3Results = checkDiscovery({ record: r3Record, ui: r3Record.ui, wireframes: wireframesUnchanged });
  const reviewed3 = r3Results.find((x) => x.id === 'discovery:reviewed');
  assert.equal(reviewed3.state, 'fail', 'journey re-mint must fail discovery:reviewed');
  assert.ok(/journey record was re-minted/.test(reviewed3.why), `why must name the record-body re-mint branch: ${reviewed3.why}`);
  // The record-body branch must NOT name a changed wireframe path
  // (every per-wireframe hash is unchanged here); the earlier
  // branch (changed wireframe bytes) is the one that lists paths.
  assert.deepEqual(reviewed3.failingIds, [], `record-body branch must not list wireframe paths in failingIds: ${JSON.stringify(reviewed3.failingIds)}`);

  // One more review restores pass.
  const r4 = runCli(['discover', 'journey', 'review', '--by', 'Reviewer Two'], scratch);
  assert.equal(r4.status, 0, `review on the re-minted record must pass: ${r4.stdout}\n${r4.stderr}`);
});

test('AC-18904-5 must-not: the managed agentinstructions block', async () => {
  // The managed canonical block carries the rule that the harness
  // never runs the journey review verb on its own, next to the
  // ADR-4132 prototype rule. We assert against the shipped canonical
  // text so neither `rcf init` nor `rcf doctor --fix` can rewrite the
  // block without the rule.
  const canonicalPath = resolve(repoRoot, 'guidance', 'managed', 'agent-instructions-block.md');
  const canonical = await readFile(canonicalPath, 'utf8');
  // ADR-4132 prototype rule is still present.
  assert.ok(/### Prototypes in DISCOVERY \(ADR-4132\)/.test(canonical), 'ADR-4132 prototype rule must stay in the managed block');
  // The journey-review rule lands beside the prototype rule.
  assert.ok(/### Journey review \(ADR-4146\)/.test(canonical), 'the journey-review rule must be present in the managed block');
  assert.ok(/Never run `rcf discover journey review` on your own/.test(canonical), 'the rule body must forbid the harness from running review on its own');
  assert.ok(/No other verb ever writes\s+ReviewStamp/.test(canonical), 'the rule body must say no other verb writes ReviewStamp');
  // Order: the review rule sits beside (immediately after) the
  // prototype rule. "Beside" in a markdown doc = adjacent H3.
  const protoIdx = canonical.indexOf('### Prototypes in DISCOVERY (ADR-4132)');
  const reviewIdx = canonical.indexOf('### Journey review (ADR-4146)');
  assert.ok(protoIdx > 0 && reviewIdx > protoIdx, 'review rule must land beside the prototype rule (adjacent H3)');

  // The hash file matches the current canonical content (gen-managed-
  // artefacts.mjs ran as part of this FBS). Doctor's stale-hash check
  // consults this file at every init/doctor pass; a drift here would
  // report stale on a fresh install.
  const hashPath = resolve(repoRoot, 'guidance', 'managed', 'agent-instructions-block.hash');
  const shippedHash = (await readFile(hashPath, 'utf8')).trim();
  const recomputed = createHash('sha256').update(canonical.trim(), 'utf8').digest('hex');
  assert.equal(shippedHash, recomputed, 'guidance/managed/agent-instructions-block.hash must match the canonical content');

  // No verb other than journey review writes ReviewStamp: the add,
  // import and show verbs are the ones that mutate (show is a read).
  // We exercise `add` end-to-end and confirm the review field stays
  // null (and that an operator could not re-review by running add).
  const scratch = mkProject();
  await setupProject(scratch);
  // First land a stamped record via the review verb path.
  const seedRecord = completeRecord({ ui: 'central', wireframes: {
    home: 'rcf/discovery/wireframes/home.md',
  } });
  seedRecord.screens = [
    { id: 'SCR-001', slug: 'home', title: null, wireframe: 'rcf/discovery/wireframes/home.md', references: [] },
  ];
  seedRecord.journeys[0].steps = [
    { id: 'JNY-001-001', slug: 'start', kind: 'entry', screenId: 'SCR-001', label: null, next: ['JNY-001-002'], returnsTo: null },
    { id: 'JNY-001-002', slug: 'finish', kind: 'exit', screenId: 'SCR-001', label: null, next: [], returnsTo: null },
  ];
  const dir = join(scratch, 'rcf', 'discovery', 'wireframes');
  await writeFile(join(dir, 'home.md'), '# home\n', 'utf8');
  await writeJourneyRecord({ projectRoot: scratch, record: seedRecord });
  const rSeed = runCli(['discover', 'journey', 'review', '--by', 'Reviewer One'], scratch);
  assert.equal(rSeed.status, 0, `seed review must pass: ${rSeed.stdout}\n${rSeed.stderr}`);
  const afterSeed = await readJourneyRecord(scratch);
  assert.ok(afterSeed.review, 'the seed review verb must write the stamp');
  const seededHash = afterSeed.review.at.hash;

  // Now re-mint the journey via `add`. If `add` wrote a new stamp,
  // the hash would be refreshed. The AC says it must not: the stamp
  // either stays verbatim or (if the record body changes) reads as
  // stale on the next check. The current implementation preserves
  // the stamp verbatim across an add; the discovery:reviewed check
  // is the enforcement that catches a journey-content change.
  const source = join(scratch, 'journey-v2.rcf');
  await writeFile(source, [
    '# Journey: signup-v2',
    '- entry start @home start',
    '- exit done @home done',
  ].join('\n') + '\n', 'utf8');
  const rAdd = runCli(['discover', 'journey', 'add', '--from', source], scratch);
  assert.equal(rAdd.status, 0, `add must succeed: ${rAdd.stdout}\n${rAdd.stderr}`);
  const afterAdd = await readJourneyRecord(scratch);
  // The stamp still carries the pre-add state (add never writes a
  // ReviewStamp of its own). The at.hash is the pre-add value; the
  // check verb will catch the mismatch, but the file bytes prove the
  // stamp was NOT rewritten by `add`.
  assert.ok(afterAdd.review, 'add must not strip the stamp');
  assert.equal(afterAdd.review.at.hash, seededHash, 'add must not re-stamp the record (at.hash is preserved verbatim)');
});
