// FBS-231 round 8 (US-16103 AC-16103-4): the stage-keeper's round 8 ruling
// (decision 88) on the main checkout's feedback store while other commands
// change it.
//
// 1. A command still running on this host that is taking over a stopped
//    move's hold is never set aside, however old its claim looks by a later
//    command's clock (age passes a claim only when the process cannot be
//    checked).
// 2. A command that holds the store and has been judged stopped by a later
//    command (its clock behind the later command's, or held past the stale
//    window) writes nothing more once it has lost the store: it exits 1
//    naming the hold it lost, and the later command's write is kept (the
//    round 7 gate's probe g9 L11, forced).
// 3. A filing that rcf feedback submit in a worktree could not record (the
//    worktree's own store, while the main checkout does not ignore it yet)
//    moves into the main checkout's store with the held queue exactly once,
//    and the next submit in either checkout does not file that entry again.
// 4. rcf feedback submit that has filed and recorded an issue and then finds
//    the store busy for a later write of the same run exits 1 naming what
//    it filed and recorded, never saying it wrote nothing.
// 5. rcf feedback submit --dry-run does not list an entry an earlier submit
//    filed but could not record.
// 6. A command that stopped while it was taking over a stopped move's hold
//    leaves no claim behind once a later command passes it.
//
// Every interleaving is forced: the children load the run 2 preload
// test/_helpers/feedback-lock-pause.mjs, the round 7 preload
// test/_helpers/feedback-break-pause.mjs and, where a test needs its points,
// the round 8 preload test/_helpers/feedback-fence-pause.mjs (a pause just
// after a holder has read the ledger it is about to rewrite, and a pause
// before a command takes the store again after it recorded a filing).
// Submit files through the configurable gh fake (test/_helpers/gh-fake-hold.mjs,
// RCF_FEEDBACK_GH_MODULE); no network. No sleep, timer or retry decides an
// outcome; a clock is moved ahead by the preload where a test needs a
// command judged stopped, and the writers' wait is shortened through
// RCF_FEEDBACK_LOCK_WAIT_MS where a test holds the store past it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import {
  askedIn, assertOutcome, assertRaceExit, feedbackStatusLines, git, heldWorld, hookArgs, hookStdin, linesIn, listIn,
  paused, reap, release, snapshot, sortPairs, storeOf, wholeSecond,
} from '../_helpers/feedback-race-world.js';
import { SHORT_WAIT_MS, killHeld, runWatched, startWatched } from '../_helpers/feedback-lock-world.js';
import { aheadFile, ghDouble, heldPollingOrExited, holdOf } from '../_helpers/feedback-break-world.js';
import { filingsOf, firstFiled, startFence, unignoredMainWorld } from '../_helpers/feedback-fence-world.js';

const LIST = ['feedback', 'list', '--all', '--json'];
const SUBMIT = ['feedback', 'submit', '--yes'];
const ISSUE_ONE = 'https://github.com/Stravica/rcf-lite/issues/701';
const SCENARIO = {
  search: { matches: [] },
  search_closed: { matches: [] },
  create: [
    { url: ISSUE_ONE, number: 701 },
    { url: 'https://github.com/Stravica/rcf-lite/issues/702', number: 702 },
  ],
};
// The first create files, every later one fails (the retry included), so
// the second entry of the run routes to an outbox bundle (AC-16001-2).
const FILE_THEN_BUNDLE = { ...SCENARIO, create: [{ url: ISSUE_ONE, number: 701 }, { error: 'ratelimit' }] };
const AHEAD_MS = 120_000;

function namesPath(text, p) {
  return text.includes(p) || (existsSync(p) && text.includes(realpathSync(p)));
}

// Let a child run to its end: release each of its pause points as it
// reaches it, until it exits (bounded).
async function finish(ctrl, h, points) {
  const start = Date.now();
  const let_ = new Set();
  while (!h.exited) {
    for (const p of points) {
      if (!let_.has(p) && existsSync(join(ctrl, `paused-${h.id}-${p}`))) {
        let_.add(p);
        release(ctrl, h, p);
      }
    }
    assert.equal(readdirSync(ctrl).filter((f) => f.startsWith(`timeout-${h.id}-`)).length, 0, `fixture: no pause of ${h.id} ran out`);
    assert.ok(Date.now() - start < 7000, `fixture: ${h.id} (${h.args.join(' ')}) ran to its end within 7000 ms\nstderr:\n${h.stderr}`);
    await delay(5);
  }
  return h.result;
}

// The main checkout's own entries as [id, title] pairs.
function titled(main) {
  return linesIn(storeOf(main)).map((l) => JSON.parse(l)).filter((e) => typeof e.title === 'string').map((e) => [e.id, e.title]);
}

// A worktree move held inside the move, then stopped (SIGKILL): its hold
// stays behind with a process id that no longer runs.
async function stoppedMove(t, w) {
  const stopped = startWatched(w.lane, LIST, { race: w.race('stopped', ['outbox-write']) });
  reap(t, [stopped]);
  await paused(w.ctrl, stopped, 'outbox-write');
  await killHeld(stopped);
}

test("AC-16103-4: a Stop hook still running on this host that is taking over a stopped move's hold is never set aside, however old its claim looks by a later command's clock: the later Stop hook waits, exactly one command holds the main checkout store at any instant, and each hook's ask record lands exactly once", async (t) => {
  const w = await heldWorld('rcf-fbs231-fence-live-claim-', { shape: 'both', clock: wholeSecond() });
  await stoppedMove(t, w);
  // The first breaker judges the stopped move's hold stale and is held just
  // before it breaks it: it is inside its claim, and running.
  const first = startFence(w.main, hookArgs('stop'), {
    stdin: hookStdin('stop', 'claimant-session'), race: w.race('claimant', []), breakAt: ['lock-break'],
  });
  reap(t, [first]);
  assert.equal(await heldPollingOrExited(w.ctrl, first, ['lock-break']), 'lock-break',
    "fixture: the first Stop hook judged the stopped move's hold stale and is held before it breaks it");
  // The second runs with its clock 120 seconds ahead: by its clock the
  // first one's claim was made two minutes ago.
  // A later command that waits on the claim is held there (waiting) until
  // the first has run to its end, so its clock never judges the first one's
  // own hold, once taken, while the first works.
  const second = startFence(w.main, hookArgs('stop'), {
    stdin: hookStdin('stop', 'later-session'), race: w.race('later', ['state-write']), fenceAt: ['waiting'],
    ahead: { ms: AHEAD_MS, file: aheadFile(w.ctrl, 'later', true) },
  });
  reap(t, [second]);
  let s2 = await heldPollingOrExited(w.ctrl, second, ['state-write', 'waiting']);
  if (s2 === 'polling') {
    await paused(w.ctrl, second, 'waiting');
    s2 = 'waiting';
  }
  t.diagnostic(`the later Stop hook: ${s2} while the first is held inside its claim`);
  // The first lets go of its break and runs to its end.
  release(w.ctrl, first, 'lock-break');
  const s1 = await heldPollingOrExited(w.ctrl, first, []);
  const twoHolders = s2 === 'state-write' && s1 === 'exited';
  if (s2 === 'waiting') release(w.ctrl, second, 'waiting');
  const [r1, r2] = await Promise.all([finish(w.ctrl, first, []), finish(w.ctrl, second, ['state-write'])]);
  assert.equal(r1.code, 2, `the first Stop hook asks (exit 2) as it would alone\nstderr:\n${r1.stderr}`);
  assert.equal(r2.code, 2, `the later Stop hook asks (exit 2) as it would alone\nstderr:\n${r2.stderr}`);
  await assertOutcome(w, {
    extra: () => {
      const asked = askedIn(storeOf(w.main));
      for (const s of ['claimant-session', 'later-session']) {
        assert.equal(asked.filter((a) => a?.sessionId === s).length, 1,
          `each Stop hook's ask record is in the main checkout state.json exactly once (never lost to another holder's write): ${s} in ${JSON.stringify(asked)}`);
      }
    },
  });
  assert.equal(twoHolders, false,
    'exactly one command holds the main checkout store at any instant: the first Stop hook never takes the store while the later one, which set its running claim aside, is held inside its own read and write');
});

test("AC-16103-4: a Stop hook that holds the main checkout store and is judged stopped by a later Stop hook (its clock behind the later one, the probe g9 L11 shape, or held past the stale window) never writes over the later hook's write: it exits 1 naming the hold it lost, and both hooks' ask records are kept", async (t) => {
  const w = await heldWorld('rcf-fbs231-fence-lost-hold-', { shape: 'both', clock: wholeSecond() });
  const shapes = [
    { name: 'its clock 120 seconds behind the later hook (probe g9 L11)', jump: false },
    { name: 'held past the stale window (every clock moved on 120 seconds)', jump: true },
  ];
  const runs = [];
  for (const [i, shape] of shapes.entries()) {
    const held = `held-${i + 1}`;
    const later = `later-${i + 1}`;
    const jump = aheadFile(w.ctrl, held);
    // The holder takes the store and is held just after it has read the
    // ledger it is about to rewrite.
    const holder = startFence(w.main, hookArgs('stop'), {
      stdin: hookStdin('stop', `${held}-session`), race: w.race(held, []), fenceAt: ['state-read'],
      ahead: { ms: AHEAD_MS, file: jump },
    });
    reap(t, [holder]);
    await paused(w.ctrl, holder, 'state-read');
    const hold = holdOf(w.ctrl, holder);
    if (shape.jump) writeFileSync(jump, 'now');
    // The later hook's clock is 120 seconds ahead of the holder's start: by
    // its clock the holder has not refreshed its hold for two minutes.
    const r2 = await startFence(w.main, hookArgs('stop'), {
      stdin: hookStdin('stop', `${later}-session`), race: w.race(later, []),
      ahead: { ms: AHEAD_MS, file: aheadFile(w.ctrl, later, true) },
    }).result;
    release(w.ctrl, holder, 'state-read');
    const r1 = await holder.result;
    runs.push({ shape: shape.name, held, later, hold, r1, r2 });
  }
  // One more Stop hook run for each holder's session (the hook runs again at
  // the next stop): a holder that wrote nothing asks then.
  for (const r of runs) await runWatched(w.main, hookArgs('stop'), { stdin: hookStdin('stop', `${r.held}-session`) });
  const asked = askedIn(storeOf(w.main));
  for (const r of runs) {
    for (const s of [r.later, r.held]) {
      assert.equal(asked.filter((a) => a?.sessionId === `${s}-session`).length, 1,
        `${r.shape}: the ${s === r.later ? 'later' : 'set-aside'} Stop hook's ask record is in the main checkout state.json exactly once (the set-aside holder never writes over the later hook's write): ${s}-session in ${JSON.stringify(asked)}`);
    }
  }
  for (const r of runs) {
    assert.equal(r.r2.code, 2, `${r.shape}: the later Stop hook asks (exit 2)\nstderr:\n${r.r2.stderr}`);
    assert.equal(r.r1.code, 1, `${r.shape}: the set-aside Stop hook exits 1 once it finds it lost the store\nstdout:\n${r.r1.stdout}\nstderr:\n${r.r1.stderr}`);
    assert.ok(namesPath(r.r1.stderr, r.hold), `${r.shape}: stderr names the hold the Stop hook lost (${r.hold})\nstderr:\n${r.r1.stderr}`);
  }
  await assertOutcome(w);
});

test('AC-16103-4: a filing that rcf feedback submit in a worktree could not record (the main checkout did not ignore the store yet) moves into the main checkout store with the held queue exactly once, and the next submit in either checkout does not file that entry again', async (t) => {
  const w = await unignoredMainWorld('rcf-fbs231-fence-held-filing-', { clock: wholeSecond() });
  const [[heldId]] = w.heldIds;
  const title = 'held in the worktree, pending, filed by a submit there';
  // A Stop hook in the worktree holds the worktree's own store, held before
  // its ledger write.
  const holder = startWatched(w.lane, hookArgs('stop'), { stdin: hookStdin('stop', 'lane-session'), race: w.race('holder', ['state-write']) });
  reap(t, [holder]);
  await paused(w.ctrl, holder, 'state-write');
  const gh = ghDouble(w.ctrl, 'lane', SCENARIO);
  const busy = await runWatched(w.lane, SUBMIT, { env: { ...gh.env, RCF_FEEDBACK_LOCK_WAIT_MS: SHORT_WAIT_MS } });
  assert.equal(busy.code, 1, `fixture: rcf feedback submit in the worktree filed the entry and could not record it (exit 1)\nstdout:\n${busy.stdout}\nstderr:\n${busy.stderr}`);
  assert.ok(busy.stderr.includes(ISSUE_ONE) && busy.stderr.includes(heldId), `fixture: stderr names the filed issue and the entry\nstderr:\n${busy.stderr}`);
  assert.equal(filingsOf(gh, title).length, 1, 'fixture: the entry was filed once');
  release(w.ctrl, holder, 'state-write');
  await holder.result;
  // The main checkout gains the ignore rule; the next command in the
  // worktree moves the held queue.
  await w.ignoreInMain();
  const move = await runWatched(w.lane, LIST);
  assert.equal(move.code, 0, `the next rcf feedback command in the worktree moves the held queue (exit 0)\nstderr:\n${move.stderr}`);
  const inMain = await runWatched(w.main, SUBMIT, { env: gh.env });
  const inLane = await runWatched(w.lane, SUBMIT, { env: gh.env });
  assert.equal(filingsOf(gh, title).length, 1,
    `the entry is filed exactly once: the next rcf feedback submit in the main checkout and in the worktree does not file it again (${heldId})\nmain:\n${inMain.stdout}${inMain.stderr}\nworktree:\n${inLane.stdout}${inLane.stderr}`);
  assert.equal(inMain.code, 0, `the next rcf feedback submit in the main checkout exits 0\nstderr:\n${inMain.stderr}`);
  assert.equal(inLane.code, 0, `the next rcf feedback submit in the worktree exits 0\nstderr:\n${inLane.stderr}`);
  assert.deepEqual(Object.keys(snapshot(w.heldDir)), [], 'no held file (the kept filing included) is left under the worktree .rcf/feedback/');
  assert.deepEqual(await listIn(w.main), [[heldId, 'submitted']], 'rcf feedback list --all --json from the main checkout lists the filed entry once, submitted');
  let removeError = null;
  try { git(w.main, 'worktree', 'remove', w.lane); } catch (err) { removeError = String(err.stderr ?? err.message); }
  assert.equal(removeError, null, `git worktree remove (no --force) succeeds: ${removeError}`);
  assert.deepEqual(feedbackStatusLines(w.main), [], 'git status in the main checkout lists nothing under .rcf/feedback/');
});

test('AC-16103-4: rcf feedback submit that has filed and recorded an issue and then finds the main checkout store busy for a later write of the same run (its outbox bundle) exits 1 naming the entry and the issue it filed, never saying it wrote nothing', async (t) => {
  const w = await heldWorld('rcf-fbs231-fence-busy-after-filing-', { shape: 'both', clock: wholeSecond() });
  const own = titled(w.main);
  const gh = ghDouble(w.ctrl, 'busy', FILE_THEN_BUNDLE);
  // Submit files the first entry and records it, gives the store up, and is
  // held before it takes the store again (for the second entry's bundle).
  const submit = startFence(w.main, SUBMIT, {
    race: w.race('submit', []), fenceAt: ['retake-after-record'], record: ISSUE_ONE,
    env: { ...gh.env, RCF_FEEDBACK_LOCK_WAIT_MS: SHORT_WAIT_MS },
  });
  reap(t, [submit]);
  const st = await heldPollingOrExited(w.ctrl, submit, ['retake-after-record']);
  t.diagnostic(`submit ${st} after recording its filing`);
  let mover = null;
  if (st === 'retake-after-record') {
    mover = startWatched(w.lane, LIST, { race: w.race('mover', ['outbox-write']) });
    reap(t, [mover]);
    await paused(w.ctrl, mover, 'outbox-write');
    release(w.ctrl, submit, 'retake-after-record');
  }
  const r = await submit.result;
  const filed = firstFiled(gh, own);
  assert.equal(filed.url, ISSUE_ONE, 'fixture: the gh double filed the first issue');
  assert.doesNotMatch(r.stderr, /wrote nothing/i, `stderr never says the submit wrote nothing (it filed and recorded ${filed.id})\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  if (r.code !== 0) {
    assert.equal(r.code, 1, `rcf feedback submit exits 1 once its wait for the held move runs out\nstderr:\n${r.stderr}`);
    assert.ok(r.stderr.includes(filed.id), `stderr names the entry the submit filed and recorded (${filed.id})\nstderr:\n${r.stderr}`);
    assert.ok(r.stderr.includes(ISSUE_ONE), `stderr names the issue the submit filed (${ISSUE_ONE})\nstderr:\n${r.stderr}`);
  }
  if (mover) {
    release(w.ctrl, mover, 'outbox-write');
    assertRaceExit(await mover.result, w.main, 'rcf feedback list in the worktree (the held move)');
  }
  const again = await runWatched(w.main, SUBMIT, { env: gh.env });
  assert.equal(again.code, 0, `the next rcf feedback submit --yes exits 0\nstdout:\n${again.stdout}\nstderr:\n${again.stderr}`);
  assert.equal(filingsOf(gh, filed.title).length, 1, `the entry is filed exactly once: the next submit does not file it again (${filed.id})`);
  const listed = await listIn(w.main);
  assert.deepEqual(listed.filter(([id]) => id === filed.id), [[filed.id, 'submitted']], 'the filed entry is listed once, submitted');
  await assertOutcome(w, { expectedIds: sortPairs([...w.heldIds, ...listed.filter(([id]) => w.ownIds.some(([o]) => o === id))]) });
});

test('AC-16103-4: rcf feedback submit --dry-run does not list an entry an earlier submit filed but could not record among those it would file, comment on or bundle, and writes nothing', async (t) => {
  const w = await heldWorld('rcf-fbs231-fence-dry-run-', { shape: 'both', clock: wholeSecond() });
  const own = titled(w.main);
  const gh = ghDouble(w.ctrl, 'dry', SCENARIO);
  // Submit files the first entry while a worktree move holds the store past
  // its wait: the filing is kept, not recorded (exit 1).
  const mover = startWatched(w.lane, LIST, { race: w.race('mover', ['outbox-write']) });
  reap(t, [mover]);
  await paused(w.ctrl, mover, 'outbox-write');
  const busy = await runWatched(w.main, SUBMIT, { env: { ...gh.env, RCF_FEEDBACK_LOCK_WAIT_MS: SHORT_WAIT_MS } });
  const filed = firstFiled(gh, own);
  assert.equal(busy.code, 1, `fixture: rcf feedback submit filed ${filed.id} and could not record it (exit 1)\nstderr:\n${busy.stderr}`);
  release(w.ctrl, mover, 'outbox-write');
  assertRaceExit(await mover.result, w.main, 'rcf feedback list in the worktree (the held move)');
  const mainStore = storeOf(w.main);
  const before = snapshot(mainStore);
  const dry = await runWatched(w.main, ['feedback', 'submit', '--dry-run', '--yes'], { env: gh.env });
  const planned = dry.stdout.split('\n').filter((l) => l.startsWith(filed.id) && /->\s*dry-run\s+(created|commented|bundle)/.test(l));
  assert.deepEqual(planned, [], `rcf feedback submit --dry-run does not list ${filed.id}, which an earlier submit filed as ${ISSUE_ONE}, among the entries it would file, comment on or bundle\nstdout:\n${dry.stdout}\nstderr:\n${dry.stderr}`);
  assert.deepEqual(snapshot(mainStore), before, 'rcf feedback submit --dry-run writes nothing under the main checkout .rcf/feedback/');
  assert.equal(filingsOf(gh, filed.title).length, 1, `the dry-run files nothing (${filed.id} filed once)`);
  const real = await runWatched(w.main, SUBMIT, { env: gh.env });
  assert.equal(real.code, 0, `the next rcf feedback submit --yes exits 0\nstdout:\n${real.stdout}\nstderr:\n${real.stderr}`);
  assert.equal(filingsOf(gh, filed.title).length, 1, `the entry is filed exactly once: the next submit does not file it again (${filed.id})`);
  await assertOutcome(w, { expectedIds: sortPairs([...w.heldIds, ...w.ownIds.map(([id]) => [id, 'submitted'])]) });
});

test("AC-16103-4: a Stop hook that stopped while it was taking over a stopped move's hold leaves no claim behind: the next command passes it, removes the claim it left and proceeds, and each held bundle, entry line and ask record lands exactly once", async (t) => {
  const w = await heldWorld('rcf-fbs231-fence-dead-claim-', { shape: 'both', clock: wholeSecond() });
  await stoppedMove(t, w);
  // A breaker judges the stopped move's hold stale, takes its claim, and is
  // stopped (SIGKILL) just before it breaks the hold.
  const dead = startFence(w.main, hookArgs('stop'), {
    stdin: hookStdin('stop', 'dead-claimant-session'), race: w.race('dead', []), breakAt: ['lock-break'],
  });
  reap(t, [dead]);
  assert.equal(await heldPollingOrExited(w.ctrl, dead, ['lock-break']), 'lock-break',
    "fixture: the Stop hook judged the stopped move's hold stale and is held before it breaks it");
  const claim = holdOf(w.ctrl, dead);
  await killHeld(dead);
  assert.ok(existsSync(claim), `fixture: the stopped claimant's claim is still there: ${claim}`);
  const r = await runWatched(w.main, hookArgs('stop'), { stdin: hookStdin('stop', 'next-session') });
  assert.equal(r.code, 2, `the next Stop hook passes the stopped claimant, breaks the stopped move's hold and asks (exit 2)\nstderr:\n${r.stderr}`);
  assert.equal(existsSync(claim), false, `the claim the stopped claimant left is removed once the next command has passed it: ${claim} (main store: ${readdirSync(storeOf(w.main)).join(', ')})`);
  await assertOutcome(w, {
    extra: () => {
      const asked = askedIn(storeOf(w.main));
      assert.equal(asked.filter((a) => a?.sessionId === 'next-session').length, 1, `the next Stop hook's ask record is in the main checkout state.json exactly once: ${JSON.stringify(asked)}`);
    },
  });
});
