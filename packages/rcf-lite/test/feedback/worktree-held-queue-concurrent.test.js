// FBS-231 round 6 (US-16103, AC-16103-4): every concurrent path that touches
// the main checkout's outbox and a linked worktree's held queue. A queue the
// worktree holds as 0.36.0 left it is moved into the main checkout's store by
// the next rcf feedback command run in the worktree; here two or more
// commands do that at once, or a command in either checkout writes to the
// main store while a move is in flight:
//
// 1. Two moves of one held bundle at once (the minimal form), and the round 5
//    gate's probe g8 shape: eight commands over 300 held bundles.
// 2. rcf feedback add in the worktree (a second mover) and in the main
//    checkout while a worktree move is held.
// 3. The SessionEnd hook in the main checkout writing a bundle under a held
//    bundle's name before and after the held move copies it, and the
//    worktree's own SessionEnd hook while another worktree move is held.
// 4. The Stop hook in the main checkout writing its ask ledger while a
//    worktree move runs, and rcf feedback submit in the main checkout writing
//    its bundle under a held bundle's name after the move copied it.
// 5. Two linked worktrees of one main checkout moving their own held queues
//    into its store at once.
//
// Every interleaving is forced: the children load the test-side preload
// test/_helpers/feedback-pause.mjs, which holds a command before a real call
// at a named point (a write into the main outbox, entries.jsonl or
// state.json, or the removal of a held file) until the test releases it, and
// a barrier starts the racing commands together. No sleep, timer or retry
// decides an outcome. A writer's same-second name comes from the same
// preload pinning that child's clock to the held bundle's instant. After the
// race one more rcf feedback command runs in the worktree and the outcome is
// checked: each held bundle's bytes in exactly one file of the main outbox,
// each held entries line and ask record once, every bundle and entry written
// during the race kept, no held file left, every id listed once, and the
// worktree removed without --force.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import {
  NO_GH_PATH, addLane, askedIn, assertOutcome, assertRaceExit, barrier, heldWorld, hookArgs, hookStdin, listIn, namesHolding,
  newOutboxBytes, paused, pausedOrExited, reap, release, rcf, sortPairs, startRcf, storeOf, wholeSecond,
} from '../_helpers/feedback-race-world.js';

// Start the movers held at the barrier, release them together, then drive
// each one held inside the move: all of them first read the main store and
// stop before their first write into the main outbox; then, one at a time,
// each is let through its copies and stopped before it removes a held file;
// then each is let finish. A command that never reaches a point (it does not
// move) is let finish as it is.
async function raceMovers(w, verbs) {
  const handles = verbs.map((args, i) => startRcf(w.lane, args, {
    race: w.race(`mover-${i + 1}`, ['outbox-write', 'held-remove'], { barrier: true }),
  }));
  return handles;
}

async function driveMovers(w, handles) {
  await barrier(w.ctrl, handles);
  const at = new Map();
  for (const h of handles) at.set(h, await pausedOrExited(w.ctrl, h, 'outbox-write'));
  assert.ok([...at.values()].includes('paused'), 'fixture: at least one command is held inside the move before its first write into the main outbox');
  for (const h of handles) {
    if (at.get(h) !== 'paused') continue;
    release(w.ctrl, h, 'outbox-write');
    at.set(h, await pausedOrExited(w.ctrl, h, 'held-remove'));
  }
  for (const h of handles) if (at.get(h) === 'paused') release(w.ctrl, h, 'held-remove');
  return Promise.all(handles.map((h) => h.result));
}

const VERBS = [
  ['feedback', 'list', '--all', '--json'], ['feedback', 'status'], ['feedback', 'list'], ['feedback', 'list', '--json'],
  ['feedback', 'list', '--all', '--json'], ['feedback', 'status', '--json'], ['feedback', 'list', '--all'], ['feedback', 'preview'],
];

test('AC-16103-4: two rcf feedback commands run at once in a linked worktree move its held queue into the main checkout once, each held bundle in exactly one file of the main outbox', async (t) => {
  const w = await heldWorld('rcf-fbs231-race-two-', { clock: wholeSecond() });
  const handles = await raceMovers(w, VERBS.slice(0, 2));
  reap(t, handles);
  const results = await driveMovers(w, handles);
  results.forEach((r, i) => assertRaceExit(r, w.main, `rcf ${handles[i].args.join(' ')} (racing)`));
  await assertOutcome(w);
});

test('AC-16103-4: eight rcf feedback commands run at once in a linked worktree holding 300 outbox bundles move its held queue into the main checkout once, each held bundle in exactly one file of the main outbox', async (t) => {
  const w = await heldWorld('rcf-fbs231-race-eight-', { clock: wholeSecond(), variants: 299 });
  assert.equal(w.heldBundles.length, 300, 'fixture: the worktree holds 300 outbox bundles');
  const handles = await raceMovers(w, VERBS);
  reap(t, handles);
  const results = await driveMovers(w, handles);
  results.forEach((r, i) => assertRaceExit(r, w.main, `rcf ${handles[i].args.join(' ')} (racing)`));
  await assertOutcome(w);
});

// rcf feedback add while a worktree move is held after reading the main
// entries.jsonl and before writing it.
async function addWhileHeld(t, w, addIn) {
  const mover = startRcf(w.lane, ['feedback', 'list', '--all', '--json'], { race: w.race('mover', ['entries-write']) });
  reap(t, [mover]);
  await paused(w.ctrl, mover, 'entries-write');
  const add = await rcf(addIn, ['feedback', 'add', '--kind', 'core', '--target', 'rcf verify run', '--anchor', 'AC-101-1',
    '--class', 'verb-error', '--severity', 'minor', '--title', 'recorded while the move runs', '--body', 'fixture entry',
    '--evidence', 'rcf verify run', '--harness', 'claude-code']);
  assertRaceExit(add, w.main, 'rcf feedback add (while the move runs)');
  release(w.ctrl, mover, 'entries-write');
  assertRaceExit(await mover.result, w.main, 'rcf feedback list (the held move)');
  if (add.code === 0) return /recorded (fb-[0-9a-z-]+)/.exec(add.stdout)?.[1];
  // The add failed on the move; it records the entry when run again.
  const again = await rcf(addIn, ['feedback', 'add', '--kind', 'core', '--target', 'rcf verify run', '--anchor', 'AC-101-1',
    '--class', 'verb-error', '--severity', 'minor', '--title', 'recorded while the move runs', '--body', 'fixture entry',
    '--evidence', 'rcf verify run', '--harness', 'claude-code']);
  assert.equal(again.code, 0, `rcf feedback add run again exits 0\nstderr:\n${again.stderr}`);
  return /recorded (fb-[0-9a-z-]+)/.exec(again.stdout)?.[1];
}

async function assertAddedOnce(w, added) {
  assert.ok(added, 'the add records an entry id');
  const pairs = await listIn(w.main);
  assert.deepEqual(pairs.filter(([id]) => id === added), [[added, 'pending']],
    'the entry recorded while the move ran is listed from the main checkout exactly once, pending, after git worktree remove');
}

test('AC-16103-4: rcf feedback add in a linked worktree while another command there is moving its held queue records its entry once and moves every held entry line into the main checkout exactly once', async (t) => {
  const w = await heldWorld('rcf-fbs231-race-add-lane-', { shape: 'both', clock: wholeSecond() });
  const added = await addWhileHeld(t, w, w.lane);
  await assertOutcome(w, { expectedIds: sortPairs([...w.heldIds, ...w.ownIds, [added, 'pending']]) });
  await assertAddedOnce(w, added);
});

test('AC-16103-4 guard: rcf feedback add in the main checkout while a linked worktree moves its held queue keeps the new entry and every held entry line exactly once', async (t) => {
  const w = await heldWorld('rcf-fbs231-race-add-main-', { shape: 'both', clock: wholeSecond() });
  const added = await addWhileHeld(t, w, w.main);
  await assertOutcome(w, { expectedIds: sortPairs([...w.heldIds, ...w.ownIds, [added, 'pending']]) });
  await assertAddedOnce(w, added);
});

// The main checkout's SessionEnd hook, its clock pinned to the held
// SessionEnd bundle's instant, so its bundle takes the held bundle's name.
async function mainSessionEnd(w) {
  const r = await rcf(w.main, hookArgs('session-end'), { stdin: hookStdin('session-end', 'main-end-session'), clock: w.clock });
  assert.equal(r.code, 0, `the main checkout SessionEnd hook exits 0\nstderr:\n${r.stderr}`);
  return r;
}

function keptOnce(w, label, bytes) {
  return () => {
    const where = namesHolding(storeOf(w.main), bytes);
    assert.equal(where.length, 1, `${label} bytes are in exactly one file of the main checkout outbox (kept, never overwritten): [${where.join(', ')}]`);
  };
}

test("AC-16103-4 guard: when the main checkout SessionEnd hook writes a bundle under a held bundle's name before a running worktree move copies that bundle, both bundles are kept, each in exactly one file of the main outbox", async (t) => {
  const w = await heldWorld('rcf-fbs231-race-hook-before-', { shape: 'both', clock: wholeSecond() });
  const mover = startRcf(w.lane, ['feedback', 'list', '--all', '--json'], { race: w.race('mover', ['outbox-write']) });
  reap(t, [mover]);
  await paused(w.ctrl, mover, 'outbox-write');
  await mainSessionEnd(w);
  const hookBytes = readFileSync(join(storeOf(w.main), 'outbox', w.seName), 'utf8');
  assert.notEqual(hookBytes, w.held[`outbox/${w.seName}`], `fixture: the main SessionEnd hook wrote ${w.seName} with bytes other than the held bundle's`);
  release(w.ctrl, mover, 'outbox-write');
  assertRaceExit(await mover.result, w.main, 'rcf feedback list (the held move)');
  await assertOutcome(w, { extra: keptOnce(w, 'the main checkout SessionEnd hook bundle', hookBytes) });
});

test("AC-16103-4: when the main checkout SessionEnd hook writes a bundle under a held bundle's name after a running worktree move copied that bundle, both bundles are kept, each in exactly one file of the main outbox", async (t) => {
  const w = await heldWorld('rcf-fbs231-race-hook-after-', { shape: 'both', clock: wholeSecond() });
  const mover = startRcf(w.lane, ['feedback', 'list', '--all', '--json'], { race: w.race('mover', ['held-remove']) });
  reap(t, [mover]);
  await paused(w.ctrl, mover, 'held-remove');
  assert.equal(namesHolding(storeOf(w.main), w.held[`outbox/${w.seName}`]).length, 1, 'fixture: the held move has copied the SessionEnd bundle into the main outbox');
  const known = w.heldBundles.map((n) => w.held[`outbox/${n}`]);
  await mainSessionEnd(w);
  const written = newOutboxBytes(storeOf(w.main), known);
  assert.equal(written.length, 1, 'fixture: the main SessionEnd hook wrote one bundle');
  release(w.ctrl, mover, 'held-remove');
  assertRaceExit(await mover.result, w.main, 'rcf feedback list (the held move)');
  await assertOutcome(w, { extra: keptOnce(w, 'the main checkout SessionEnd hook bundle', written[0]) });
});

test('AC-16103-4 guard: the SessionEnd hook in a linked worktree while another command there is moving its held queue writes its bundle once and copies no held bundle a second time', async (t) => {
  const w = await heldWorld('rcf-fbs231-race-hook-lane-', { shape: 'both', clock: wholeSecond() });
  const mover = startRcf(w.lane, ['feedback', 'list', '--all', '--json'], { race: w.race('mover', ['held-remove']) });
  reap(t, [mover]);
  await paused(w.ctrl, mover, 'held-remove');
  const known = w.heldBundles.map((n) => w.held[`outbox/${n}`]);
  const later = new Date(Date.parse(w.clock) + 3_600_000).toISOString();
  const r = await rcf(w.lane, hookArgs('session-end'), { stdin: hookStdin('session-end', 'lane-end-session'), clock: later });
  assertRaceExit(r, w.main, 'the worktree SessionEnd hook (while the move runs)');
  const written = newOutboxBytes(storeOf(w.main), known);
  assert.equal(written.length, 1, `fixture: the worktree SessionEnd hook wrote one bundle into the main outbox (new bundles: ${written.length})`);
  release(w.ctrl, mover, 'held-remove');
  assertRaceExit(await mover.result, w.main, 'rcf feedback list (the held move)');
  await assertOutcome(w, { extra: keptOnce(w, 'the worktree SessionEnd hook bundle', written[0]) });
});

test("AC-16103-4: when the main checkout Stop hook writes its ask ledger while a linked worktree moves its held queue, every held ask record and the hook's own ask record are in the main checkout state.json exactly once", async (t) => {
  const w = await heldWorld('rcf-fbs231-race-stop-main-', { shape: 'both', clock: wholeSecond() });
  const stop = startRcf(w.main, hookArgs('stop'), {
    stdin: hookStdin('stop', 'main-stop-session'), race: w.race('stop', ['state-write']),
  });
  reap(t, [stop]);
  await paused(w.ctrl, stop, 'state-write');
  const mover = await rcf(w.lane, ['feedback', 'list', '--all', '--json']);
  assertRaceExit(mover, w.main, 'rcf feedback list (the move, while the Stop hook writes)');
  release(w.ctrl, stop, 'state-write');
  const s = await stop.result;
  assert.equal(s.code, 2, `the main checkout Stop hook asks (exit 2) as it would alone\nstderr:\n${s.stderr}`);
  await assertOutcome(w, {
    extra: () => {
      const asked = askedIn(storeOf(w.main));
      for (const record of JSON.parse(w.held['state.json']).asked) {
        assert.equal(asked.filter((a) => isDeepStrictEqual(a, record)).length, 1,
          `each held ask record is in the main checkout state.json exactly once (never lost to the Stop hook's write): ${JSON.stringify(record)}`);
      }
      assert.equal(asked.filter((a) => a?.sessionId === 'main-stop-session').length, 1, 'the Stop hook\'s own ask record is in the main checkout state.json exactly once');
    },
  });
});

test("AC-16103-4: when rcf feedback submit in the main checkout writes a bundle under a held bundle's name after a running worktree move copied that bundle, both bundles are kept, each in exactly one file of the main outbox", async (t) => {
  const w = await heldWorld('rcf-fbs231-race-submit-main-', { shape: 'both', clock: wholeSecond() });
  const mover = startRcf(w.lane, ['feedback', 'list', '--all', '--json'], { race: w.race('mover', ['held-remove']) });
  reap(t, [mover]);
  await paused(w.ctrl, mover, 'held-remove');
  assert.equal(namesHolding(storeOf(w.main), w.held[`outbox/${w.submitName}`]).length, 1, 'fixture: the held move has copied the submit bundle into the main outbox');
  const known = w.heldBundles.map((n) => w.held[`outbox/${n}`]);
  const submit = await rcf(w.main, ['feedback', 'submit', '--yes'], { path: NO_GH_PATH, clock: w.clock });
  assert.equal(submit.code, 0, `rcf feedback submit --yes without gh exits 0 in the main checkout\nstdout:\n${submit.stdout}\nstderr:\n${submit.stderr}`);
  assert.ok(submit.stdout.includes(w.submitName), `fixture: submit bundled the main checkout's two entries under the held bundle's name ${w.submitName}\nstdout:\n${submit.stdout}`);
  const written = newOutboxBytes(storeOf(w.main), known);
  assert.equal(written.length, 1, 'fixture: submit wrote one bundle');
  release(w.ctrl, mover, 'held-remove');
  assertRaceExit(await mover.result, w.main, 'rcf feedback list (the held move)');
  await assertOutcome(w, {
    expectedIds: sortPairs([...w.heldIds, ...w.ownIds.map(([id]) => [id, 'bundled'])]),
    extra: keptOnce(w, 'the main checkout submit bundle', written[0]),
  });
});

test('AC-16103-4: two linked worktrees moving their own held queues into the main checkout at once keep every held ask record, entry line and bundle of both, each exactly once in the main store', async (t) => {
  const w = await heldWorld('rcf-fbs231-race-two-lanes-', { clock: wholeSecond() });
  const two = await addLane(w, 'lane-two');
  const first = startRcf(w.lane, ['feedback', 'list', '--all', '--json'], { race: w.race('mover-1', ['state-write']) });
  reap(t, [first]);
  await paused(w.ctrl, first, 'state-write');
  const second = startRcf(two.lane, ['feedback', 'list', '--all', '--json'], { race: { ...w.race('mover-2', ['state-write']), held: two.lane } });
  reap(t, [second]);
  const state = await pausedOrExited(w.ctrl, second, 'state-write');
  release(w.ctrl, first, 'state-write');
  assertRaceExit(await first.result, w.main, 'rcf feedback list in the first worktree (racing)');
  if (state === 'paused') release(w.ctrl, second, 'state-write');
  assertRaceExit(await second.result, w.main, 'rcf feedback list in the second worktree (racing)');
  await assertOutcome(w, { lanes: [w, two] });
});
