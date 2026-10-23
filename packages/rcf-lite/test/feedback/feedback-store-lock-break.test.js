// FBS-231 round 7 (US-16103 AC-16103-4): the stage-keeper's round 7 ruling
// (decision 87) on the main checkout's feedback store while other commands
// change it.
//
// A. Commands that find the same stopped move's hold at once and judge it
//    stale: exactly one holds the store at any instant, every other command
//    waits (a writer) or leaves the held queue (a move), and every held
//    bundle, entry line and ask record, and each Stop hook's ask record,
//    lands exactly once (the round 6 gate's probe g9 L9 shape, forced).
// B. A command that reads the main checkout's entries.jsonl while
//    rcf feedback add (appendEntry) or rcf feedback discard (appendState)
//    writes it never reads a partial line.
// C. rcf feedback submit that has filed an issue when it meets the busy
//    store records the filing once the store is let go or its holder is
//    stale; when the store is still held past its wait it exits 1 naming the
//    issue URL and the entry id, never saying it wrote nothing, and the next
//    submit does not file that entry again.
// D. A Stop hook that does not ask (opted out) and has nothing to write
//    exits as it would alone while the store is held.
// E. A hold whose file cannot be parsed is judged by the file's age and
//    named by its path and age when it holds a writer up.
//
// Every interleaving is forced: the children load the run 2 preload
// test/_helpers/feedback-lock-pause.mjs and the round 7 preload
// test/_helpers/feedback-break-pause.mjs (a pause before and just after the
// first call that destroys a file another command made in the main store,
// a pause in the middle of a write of entries.jsonl, a record of a partial
// read, of the hold a child took and of a child waiting on another
// command's hold, and a clock moved ahead). Submit files through the
// configurable gh fake with a hold after its first create
// (test/_helpers/gh-fake-hold.mjs). No sleep, timer or retry decides an
// outcome; C and D and E shorten the writers' wait through
// RCF_FEEDBACK_LOCK_WAIT_MS where a test holds the store past it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import {
  askedIn, assertOutcome, assertRaceExit, barrier, heldWorld, hookArgs, hookStdin, linesIn, listIn,
  paused, reap, release, snapshot, sortPairs, storeOf, wholeSecond,
} from '../_helpers/feedback-race-world.js';
import { SHORT_WAIT_MS, killHeld, runWatched, startWatched } from '../_helpers/feedback-lock-world.js';
import {
  aheadFile, ghDouble, heldPollingOrExited, holdOf, partialRead, startBreak,
} from '../_helpers/feedback-break-world.js';

const LIST = ['feedback', 'list', '--all', '--json'];
const ADD_ARGS = (title) => ['feedback', 'add', '--kind', 'core', '--target', 'rcf verify run', '--anchor', 'AC-101-1',
  '--class', 'verb-error', '--severity', 'minor', '--title', title, '--body', 'fixture entry',
  '--evidence', 'rcf verify run', '--harness', 'claude-code'];
const ISSUE_ONE = 'https://github.com/Stravica/rcf-lite/issues/701';
const SCENARIO = {
  search: { matches: [] },
  search_closed: { matches: [] },
  create: [
    { url: ISSUE_ONE, number: 701 },
    { url: 'https://github.com/Stravica/rcf-lite/issues/702', number: 702 },
  ],
};

function recordedId(r) {
  return /recorded (fb-[0-9a-z-]+)/.exec(r.stdout)?.[1] ?? null;
}

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

// The main checkout entry whose issue the gh double holds as filed (its
// rendered title carries the entry's title), and that issue's URL.
function filedEntry(w, h) {
  const filed = JSON.parse(readFileSync(join(w.ctrl, `paused-${h.id}-filed`), 'utf8'));
  const e = linesIn(storeOf(w.main)).map((l) => JSON.parse(l)).find((x) => typeof x.title === 'string' && String(filed.title).includes(x.title));
  assert.ok(e, `fixture: the filed issue's title names a main checkout entry: ${filed.title}`);
  return { id: e.id, title: e.title, url: filed.url };
}

function filings(gh, title) {
  return gh.calls().filter((c) => (c.name === 'ghIssueCreate' || c.name === 'ghIssueComment')
    && String(c.args?.title ?? c.args?.body ?? '').includes(title));
}

test("AC-16103-4: three Stop hooks that find a stopped move's hold at once and judge it stale break it safely: exactly one command holds the main checkout store at any instant, and each hook's ask record and every held bundle, entry line and ask record land exactly once", async (t) => {
  const w = await heldWorld('rcf-fbs231-break-three-', { shape: 'both', clock: wholeSecond() });
  // A worktree move held inside the move, then stopped (SIGKILL): its hold
  // stays behind with a process id that no longer runs.
  const stopped = startWatched(w.lane, LIST, { race: w.race('stopped', ['outbox-write']) });
  reap(t, [stopped]);
  await paused(w.ctrl, stopped, 'outbox-write');
  await killHeld(stopped);
  const sessions = ['breaker-one-session', 'breaker-two-session', 'breaker-three-session'];
  const hooks = sessions.map((s, i) => startBreak(w.main, hookArgs('stop'), {
    stdin: hookStdin('stop', s),
    race: w.race(`breaker-${i + 1}`, i === 0 ? ['state-write'] : [], { barrier: true }),
    breakAt: i === 1 ? ['lock-break', 'lock-broken'] : ['lock-break'],
  }));
  const [one, two, three] = hooks;
  reap(t, hooks);
  await barrier(w.ctrl, hooks);
  const met = [];
  for (const h of hooks) met.push(await heldPollingOrExited(w.ctrl, h, ['lock-break']));
  t.diagnostic(`after the barrier: ${met.join(', ')}`);
  assert.ok(met.includes('lock-break'), "fixture: a Stop hook judged the stopped move's hold stale and is held before it breaks it");
  // The first lets go: it breaks the stale hold, takes the store and is held
  // before its ledger write (it has read state.json).
  let s1 = met[0];
  if (s1 === 'lock-break') {
    release(w.ctrl, one, 'lock-break');
    s1 = await heldPollingOrExited(w.ctrl, one, ['state-write']);
  }
  // The second lets go of the break it judged and is held just after it.
  let s2 = met[1];
  if (s2 === 'lock-break') {
    release(w.ctrl, two, 'lock-break');
    s2 = await heldPollingOrExited(w.ctrl, two, ['lock-broken']);
  }
  // The third lets go while the first is held inside its read and write.
  let s3 = met[2];
  if (s3 === 'lock-break') {
    release(w.ctrl, three, 'lock-break');
    s3 = await heldPollingOrExited(w.ctrl, three, []);
  }
  t.diagnostic(`first ${s1}, second ${s2}, third ${s3}`);
  const twoHolders = s1 === 'state-write' && s3 === 'exited';
  const results = await Promise.all([finish(w.ctrl, one, ['state-write']), finish(w.ctrl, two, ['lock-broken']), finish(w.ctrl, three, [])]);
  results.forEach((r, i) => assert.equal(r.code, 2, `Stop hook ${i + 1} asks (exit 2) as it would alone\nstderr:\n${r.stderr}`));
  await assertOutcome(w, {
    extra: () => {
      const asked = askedIn(storeOf(w.main));
      for (const s of sessions) {
        assert.equal(asked.filter((a) => a?.sessionId === s).length, 1,
          `each Stop hook's ask record is in the main checkout state.json exactly once (never lost to another holder's write): ${s} in ${JSON.stringify(asked)}`);
      }
    },
  });
  assert.equal(twoHolders, false,
    'exactly one command holds the main checkout store at any instant: the third Stop hook never completes its read and write while the first is held inside its own');
});

test("AC-16103-4: a command that reads the main checkout's entries.jsonl while rcf feedback add writes an entry there never reads a partial line, and lists every entry once with its status", async (t) => {
  const w = await heldWorld('rcf-fbs231-break-read-add-', { shape: 'both', clock: wholeSecond() });
  const writer = startBreak(w.main, ADD_ARGS('recorded while another command reads'), { race: w.race('writer', []), breakAt: ['entries-midwrite'] });
  reap(t, [writer]);
  await paused(w.ctrl, writer, 'entries-midwrite');
  const reader = startBreak(w.main, LIST, { race: w.race('reader', []), reads: true });
  reap(t, [reader]);
  const r = await reader.result;
  assert.equal(partialRead(w.ctrl, reader), null,
    `rcf feedback list never reads a partial line of the main checkout entries.jsonl while rcf feedback add writes it (it reads the whole file as it was before or after the write): ${partialRead(w.ctrl, reader)}`);
  assert.equal(r.code, 0, `rcf feedback list exits 0\nstderr:\n${r.stderr}`);
  const listed = sortPairs(JSON.parse(r.stdout).map((e) => [e.id, e.status]));
  assert.deepEqual(listed.filter(([id]) => w.ownIds.some(([o]) => o === id)), w.ownIds,
    'rcf feedback list lists every entry the main checkout held before once with its status');
  release(w.ctrl, writer, 'entries-midwrite');
  const a = await writer.result;
  assert.equal(a.code, 0, `rcf feedback add exits 0\nstderr:\n${a.stderr}`);
  const id = recordedId(a);
  assert.ok(id, `rcf feedback add records an entry\nstdout:\n${a.stdout}`);
  await assertOutcome(w, { expectedIds: sortPairs([...w.heldIds, ...w.ownIds, [id, 'pending']]) });
});

test("AC-16103-4: a command that reads the main checkout's entries.jsonl while rcf feedback discard records a status change there never reads a partial line, and lists every entry once with its status", async (t) => {
  const w = await heldWorld('rcf-fbs231-break-read-discard-', { shape: 'both', clock: wholeSecond() });
  const [target] = w.ownIds[0];
  const writer = startBreak(w.main, ['feedback', 'discard', target], { race: w.race('writer', []), breakAt: ['entries-midwrite'] });
  reap(t, [writer]);
  await paused(w.ctrl, writer, 'entries-midwrite');
  const reader = startBreak(w.main, LIST, { race: w.race('reader', []), reads: true });
  reap(t, [reader]);
  const r = await reader.result;
  assert.equal(partialRead(w.ctrl, reader), null,
    `rcf feedback list never reads a partial line of the main checkout entries.jsonl while rcf feedback discard writes it (it reads the whole file as it was before or after the write): ${partialRead(w.ctrl, reader)}`);
  assert.equal(r.code, 0, `rcf feedback list exits 0\nstderr:\n${r.stderr}`);
  const listed = sortPairs(JSON.parse(r.stdout).map((e) => [e.id, e.status]));
  const after = sortPairs(w.ownIds.map(([id, s]) => [id, id === target ? 'discarded' : s]));
  assert.ok(isEqual(listed, w.ownIds) || isEqual(listed, after),
    `rcf feedback list lists every entry once with the status it had before or after the discard: ${JSON.stringify(listed)}`);
  release(w.ctrl, writer, 'entries-midwrite');
  const d = await writer.result;
  assert.equal(d.code, 0, `rcf feedback discard exits 0\nstderr:\n${d.stderr}`);
  await assertOutcome(w, { expectedIds: sortPairs([...w.heldIds, ...after]) });
});

function isEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// The submit world: a filed issue held in the gh double, then a worktree
// move holding the main checkout store, then the filing let go.
async function submitMeetsHeldStore(t, w, name, opts = {}) {
  const gh = ghDouble(w.ctrl, name, SCENARIO, { hold: true });
  const submit = startBreak(w.main, ['feedback', 'submit', '--yes'], { race: w.race('submit', []), env: { ...gh.env, ...(opts.env ?? {}) }, ahead: opts.ahead });
  reap(t, [submit]);
  await paused(w.ctrl, submit, 'filed');
  const first = filedEntry(w, submit);
  assert.equal(first.url, ISSUE_ONE, 'fixture: the gh double filed the first issue');
  const mover = startWatched(w.lane, LIST, { race: w.race('mover', ['outbox-write']) });
  reap(t, [mover]);
  await paused(w.ctrl, mover, 'outbox-write');
  release(w.ctrl, submit, 'filed');
  return { gh, submit, mover, first };
}

async function submitAgain(w, gh) {
  const r = await runWatched(w.main, ['feedback', 'submit', '--yes'], { env: gh.env });
  assert.equal(r.code, 0, `the next rcf feedback submit --yes exits 0\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  return r;
}

test('AC-16103-4 guard: rcf feedback submit that has filed an issue when a worktree move holds the main checkout store waits, and records the filing once the move lets the store go; the next submit does not file the entry again', async (t) => {
  const w = await heldWorld('rcf-fbs231-break-submit-release-', { shape: 'both', clock: wholeSecond() });
  const { gh, submit, mover, first } = await submitMeetsHeldStore(t, w, 'release');
  const st = await heldPollingOrExited(w.ctrl, submit, []);
  t.diagnostic(`submit ${st} while the move holds the store`);
  release(w.ctrl, mover, 'outbox-write');
  assertRaceExit(await mover.result, w.main, 'rcf feedback list in the worktree (the held move)');
  const r = await submit.result;
  assert.equal(r.code, 0, `rcf feedback submit records the filing once the move lets the store go (exit 0)\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  await submitAgain(w, gh);
  assert.equal(filings(gh, first.title).length, 1, `the entry is filed exactly once: the next submit does not file it again (${first.id})`);
  await assertOutcome(w, { expectedIds: sortPairs([...w.heldIds, ...w.ownIds.map(([id]) => [id, 'submitted'])]) });
});

test('AC-16103-4 guard: rcf feedback submit that has filed an issue when a hung worktree move holds the main checkout store records the filing once the move has not been refreshed for 60 seconds by its clock; the next submit does not file the entry again', async (t) => {
  const w = await heldWorld('rcf-fbs231-break-submit-stale-', { shape: 'both', clock: wholeSecond() });
  const file = aheadFile(w.ctrl, 'submit');
  const { gh, submit, mover, first } = await submitMeetsHeldStore(t, w, 'stale', { ahead: { ms: 62_000, file } });
  const st = await heldPollingOrExited(w.ctrl, submit, []);
  assert.equal(st, 'polling', `fixture: rcf feedback submit waits on the held move\nstderr:\n${submit.stderr}`);
  // Submit's clock moves 62 seconds ahead: the held move, which does not
  // refresh while it is held, has not been refreshed for 62 seconds.
  writeFileSync(file, 'now');
  const r = await submit.result;
  assert.equal(r.code, 0, `rcf feedback submit records the filing once the hung move is stale (exit 0)\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  await killHeld(mover);
  await submitAgain(w, gh);
  assert.equal(filings(gh, first.title).length, 1, `the entry is filed exactly once: the next submit does not file it again (${first.id})`);
  await assertOutcome(w, { expectedIds: sortPairs([...w.heldIds, ...w.ownIds.map(([id]) => [id, 'submitted'])]) });
});

test('AC-16103-4: rcf feedback submit that has filed an issue when a worktree move holds the main checkout store past its wait exits 1 naming the issue URL and the entry id, never saying it wrote nothing, and the next submit does not file that entry again', async (t) => {
  const w = await heldWorld('rcf-fbs231-break-submit-busy-', { shape: 'both', clock: wholeSecond() });
  const { gh, submit, mover, first } = await submitMeetsHeldStore(t, w, 'busy', { env: { RCF_FEEDBACK_LOCK_WAIT_MS: SHORT_WAIT_MS } });
  const r = await submit.result;
  assert.equal(r.code, 1, `rcf feedback submit exits 1 once its wait for the held move runs out\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.ok(r.stderr.includes(ISSUE_ONE), `stderr names the issue the submit filed (${ISSUE_ONE})\nstderr:\n${r.stderr}`);
  assert.ok(r.stderr.includes(first.id), `stderr names the entry it filed (${first.id})\nstderr:\n${r.stderr}`);
  assert.doesNotMatch(r.stderr, /wrote nothing/i, `stderr never says the submit wrote nothing (it filed an issue)\nstderr:\n${r.stderr}`);
  release(w.ctrl, mover, 'outbox-write');
  assertRaceExit(await mover.result, w.main, 'rcf feedback list in the worktree (the held move)');
  await submitAgain(w, gh);
  assert.equal(filings(gh, first.title).length, 1, `the entry is filed exactly once: the next submit does not file it again (${first.id})`);
  await assertOutcome(w, { expectedIds: sortPairs([...w.heldIds, ...w.ownIds.map(([id]) => [id, 'submitted'])]) });
});

test('AC-16103-4: a Stop hook in the main checkout that does not ask (the operator opted out) and has nothing to write exits as it would alone, without waiting, while a worktree move holds the main checkout store', async (t) => {
  const w = await heldWorld('rcf-fbs231-break-opted-out-', { shape: 'both', clock: wholeSecond() });
  const optOut = await runWatched(w.main, ['feedback', 'opt-out']);
  assert.equal(optOut.code, 0, `fixture: rcf feedback opt-out in the main checkout\nstderr:\n${optOut.stderr}`);
  const kinds = [['opted out in the settings', {}], ['opted out by RCF_FEEDBACK_ASK=0', { RCF_FEEDBACK_ASK: '0' }]];
  const alone = [];
  for (const [, env] of kinds) alone.push(await runWatched(w.main, hookArgs('stop'), { stdin: hookStdin('stop', 'opted-out-session'), env }));
  alone.forEach((r) => assert.equal(r.code, 0, `fixture: alone, the opted-out Stop hook stays silent (exit 0)\nstderr:\n${r.stderr}`));
  const mover = startWatched(w.lane, LIST, { race: w.race('mover', ['outbox-write']) });
  reap(t, [mover]);
  await paused(w.ctrl, mover, 'outbox-write');
  const mainStore = storeOf(w.main);
  const held = snapshot(mainStore);
  for (const [i, [label, env]] of kinds.entries()) {
    const r = await runWatched(w.main, hookArgs('stop'), { stdin: hookStdin('stop', 'opted-out-session'), env: { ...env, RCF_FEEDBACK_LOCK_WAIT_MS: SHORT_WAIT_MS } });
    assert.equal(r.code, alone[i].code, `the Stop hook ${label} exits as it would alone (${alone[i].code}) while the move holds the store, without waiting for it\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    assert.equal(r.stdout, alone[i].stdout, `the Stop hook ${label} prints what it prints alone`);
    assert.equal(r.stderr, alone[i].stderr, `the Stop hook ${label} writes to stderr what it writes alone`);
  }
  assert.deepEqual(snapshot(mainStore), held, 'the opted-out Stop hooks write nothing under the main checkout .rcf/feedback/');
  release(w.ctrl, mover, 'outbox-write');
  assertRaceExit(await mover.result, w.main, 'rcf feedback list in the worktree (the held move)');
  await assertOutcome(w);
});

// A stopped worktree move's hold whose file can no longer be parsed (cut to
// nothing, as a holder stopped between creating its file and writing it
// leaves it).
async function unreadableHold(t, prefix) {
  const w = await heldWorld(prefix, { shape: 'both', clock: wholeSecond() });
  const stopped = startBreak(w.lane, LIST, { race: w.race('stopped', ['outbox-write']) });
  reap(t, [stopped]);
  await paused(w.ctrl, stopped, 'outbox-write');
  const hold = holdOf(w.ctrl, stopped);
  await killHeld(stopped);
  assert.ok(existsSync(hold), `fixture: the stopped move's hold is still there: ${hold}`);
  truncateSync(hold, 0);
  return { w, hold, mtimeMs: statSync(hold).mtimeMs };
}

// A clock that reads ageMs after the hold file's mtime when the child starts.
function agedClock(w, id, mtimeMs, ageMs) {
  return { ms: Math.ceil(mtimeMs) + ageMs - Date.now(), file: aheadFile(w.ctrl, id, true) };
}

test('AC-16103-4: a writer held up by a hold whose file cannot be parsed exits 1 once its wait runs out with stderr naming that file by its path and its age', async (t) => {
  const { w, hold, mtimeMs } = await unreadableHold(t, 'rcf-fbs231-break-unparsed-named-');
  const mainStore = storeOf(w.main);
  const before = snapshot(mainStore);
  const r = await startBreak(w.main, ADD_ARGS('recorded while an unreadable hold is 30 seconds old'), {
    race: w.race('writer', []), ahead: agedClock(w, 'writer', mtimeMs, 30_000), env: { RCF_FEEDBACK_LOCK_WAIT_MS: SHORT_WAIT_MS },
  }).result;
  assert.equal(r.code, 1, `rcf feedback add exits 1 once its wait runs out (a hold 30 seconds old by its file's age is not stale)\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.ok(namesPath(r.stderr, hold), `stderr names the hold that cannot be parsed by its path (${hold})\nstderr:\n${r.stderr}`);
  const ages = [...r.stderr.matchAll(/\b(\d+(?:\.\d+)?)\s*(?:s|secs?|seconds?)\b/g)].map((m) => Number(m[1]));
  assert.ok(ages.some((a) => a >= 29 && a <= 33), `stderr names the hold's age (about 30 seconds)\nstderr:\n${r.stderr}`);
  assert.deepEqual(snapshot(mainStore), before, 'a writer whose wait runs out writes nothing under the main checkout .rcf/feedback/');
});

test('AC-16103-4 guard: a hold whose file cannot be parsed is judged by the age of its file: 30 seconds old it holds a writer up (exit 1, nothing written), more than 60 seconds old it is stale and the writer proceeds', async (t) => {
  const { w, mtimeMs } = await unreadableHold(t, 'rcf-fbs231-break-unparsed-age-');
  const mainStore = storeOf(w.main);
  const before = snapshot(mainStore);
  const young = await startBreak(w.main, ADD_ARGS('recorded while an unreadable hold is 30 seconds old'), {
    race: w.race('young', []), ahead: agedClock(w, 'young', mtimeMs, 30_000), env: { RCF_FEEDBACK_LOCK_WAIT_MS: SHORT_WAIT_MS },
  }).result;
  assert.equal(young.code, 1, `rcf feedback add waits on a hold whose file is 30 seconds old and exits 1 once its wait runs out\nstdout:\n${young.stdout}\nstderr:\n${young.stderr}`);
  assert.deepEqual(snapshot(mainStore), before, 'a writer whose wait runs out writes nothing under the main checkout .rcf/feedback/');
  const old = await startBreak(w.main, ADD_ARGS('recorded once the unreadable hold is 120 seconds old'), {
    race: w.race('old', []), ahead: agedClock(w, 'old', mtimeMs, 120_000), env: { RCF_FEEDBACK_LOCK_WAIT_MS: SHORT_WAIT_MS },
  }).result;
  assert.equal(old.code, 0, `rcf feedback add proceeds (exit 0) past a hold whose file is 120 seconds old\nstdout:\n${old.stdout}\nstderr:\n${old.stderr}`);
  const id = recordedId(old);
  assert.ok(id, `rcf feedback add records an entry\nstdout:\n${old.stdout}`);
  await assertOutcome(w, { expectedIds: sortPairs([...w.heldIds, ...w.ownIds, [id, 'pending']]) });
  assert.deepEqual((await listIn(w.main)).filter(([i]) => i === id), [[id, 'pending']], 'the entry recorded past the stale hold is listed once, pending');
});
