// FBS-231 round 6, run 2 (US-16103 AC-16103-4, US-16101 AC-16101-2): every
// command that writes a checkout's feedback store while another one is
// changing it. The round 6 sweep in worktree-held-queue-concurrent.test.js
// pins the held queue's bytes; these tests pin what the stage-keeper's
// round 6 ruling adds (decision 85):
//
// A. Two Stop hooks in one checkout at once keep both asked records.
// B. A command that reads state.json while another command is writing it
//    reads a whole document: the worktree move (it keeps every ask record
//    the main checkout held before) and the Stop hook (in a session that
//    already asked it stays silent).
// C. The main checkout's Stop hook writing its ask record while a worktree
//    move is between its read and its write of state.json keeps that record.
// D. While a worktree move is still changing the main checkout's store, a
//    writer there (add, the Stop and SessionEnd hooks, submit) whose wait
//    runs out exits 1 naming the running command's process id and the main
//    checkout, and writes nothing.
// E. A move whose process stopped without finishing, or that started more
//    than 60 seconds earlier, holds up no later command.
//
// Every interleaving is forced: the children load the test-side preload
// test/_helpers/feedback-lock-pause.mjs, which holds a command at a named
// point (a write of the main checkout's state.json or outbox, before the call
// or between its start and its completion) until the test releases it, pins
// a child's clock, and records when a child finds the store busy (a
// create-only call in the main store that fails with EEXIST). The test
// releases a held command once the other command has either finished or
// found the store busy, so the same test forces the race at the shipped tree
// and lets a writer that waits go on. No sleep, timer or retry decides an
// outcome. D shortens the writers' 10 second wait through
// RCF_FEEDBACK_LOCK_WAIT_MS so the test stays inside its budget.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import {
  NO_GH_PATH, addEntry, askedIn, assertOutcome, assertRaceExit, heldWorld, hook, hookArgs, hookStdin, listIn,
  namesDir, paused, plainCheckout, reap, release, snapshot, sortPairs, storeOf, wholeSecond,
} from '../_helpers/feedback-race-world.js';
import {
  SHORT_WAIT_MS, contendedOrExited, killHeld, pausedContendedOrExited, runWatched, startWatched,
} from '../_helpers/feedback-lock-world.js';

const ADD_ARGS = (title) => ['feedback', 'add', '--kind', 'core', '--target', 'rcf verify run', '--anchor', 'AC-101-1',
  '--class', 'verb-error', '--severity', 'minor', '--title', title, '--body', 'fixture entry',
  '--evidence', 'rcf verify run', '--harness', 'claude-code'];

function recordedId(r) {
  return /recorded (fb-[0-9a-z-]+)/.exec(r.stdout)?.[1] ?? null;
}

// The main checkout's own ask records, before the race.
function ownAsked(w) {
  return askedIn(storeOf(w.main));
}

test('AC-16101-2: two Stop hooks running at once in one checkout, each for its own session_id, both ask and both keep their asked records in state.json exactly once, neither overwriting the other', async (t) => {
  const dir = await plainCheckout('rcf-fbs231-lock-two-stops-');
  await addEntry(dir, 'pending in the checkout (one)');
  await addEntry(dir, 'pending in the checkout (two)');
  const ctrl = join(dir, '..', 'ctrl');
  await mkdir(ctrl, { recursive: true });
  const race = (id, at) => ({ ctrl, id, at, main: dir });
  const first = startWatched(dir, hookArgs('stop'), { stdin: hookStdin('stop', 'stop-session-one'), race: race('stop-1', ['state-write']) });
  reap(t, [first]);
  await paused(ctrl, first, 'state-write');
  const second = startWatched(dir, hookArgs('stop'), { stdin: hookStdin('stop', 'stop-session-two'), race: race('stop-2', []) });
  reap(t, [second]);
  t.diagnostic(`the second Stop hook ${await contendedOrExited(ctrl, second)} while the first is held`);
  release(ctrl, first, 'state-write');
  const one = await first.result;
  const two = await second.result;
  assert.equal(one.code, 2, `the first Stop hook asks (exit 2) as it would alone\nstderr:\n${one.stderr}`);
  assert.equal(two.code, 2, `the second Stop hook asks (exit 2) as it would alone\nstderr:\n${two.stderr}`);
  const asked = askedIn(storeOf(dir));
  for (const session of ['stop-session-one', 'stop-session-two']) {
    assert.equal(asked.filter((a) => a?.sessionId === session).length, 1,
      `each Stop hook's asked record is in state.json exactly once (neither overwrites the other): ${session} in ${JSON.stringify(asked)}`);
  }
});

test("AC-16103-4: a worktree move that reads the main checkout's state.json while the main checkout Stop hook is writing it reads a whole document, so every ask record the main checkout held before is kept exactly once", async (t) => {
  const w = await heldWorld('rcf-fbs231-lock-read-midwrite-move-', { shape: 'both', clock: wholeSecond() });
  await hook(w.main, 'stop', 'main-earlier-session', 2);
  const before = ownAsked(w);
  assert.equal(before.length, 1, 'fixture: the main checkout holds one ask record of its own before the race');
  const writer = startWatched(w.main, hookArgs('stop'), { stdin: hookStdin('stop', 'main-stop-session'), race: w.race('writer', ['state-midwrite']) });
  reap(t, [writer]);
  await paused(w.ctrl, writer, 'state-midwrite');
  const reader = startWatched(w.lane, ['feedback', 'list', '--all', '--json'], { race: w.race('reader', ['state-write']) });
  reap(t, [reader]);
  const state = await pausedContendedOrExited(w.ctrl, reader, 'state-write');
  t.diagnostic(`the worktree command ${state} while the Stop hook is held mid-write`);
  release(w.ctrl, writer, 'state-midwrite');
  const s = await writer.result;
  assert.equal(s.code, 2, `the main checkout Stop hook asks (exit 2) as it would alone\nstderr:\n${s.stderr}`);
  if (state === 'paused') release(w.ctrl, reader, 'state-write');
  assertRaceExit(await reader.result, w.main, 'rcf feedback list in the worktree (reading state.json while it is written)');
  await assertOutcome(w, {
    extra: () => {
      const asked = askedIn(storeOf(w.main));
      for (const record of before) {
        assert.equal(asked.filter((a) => isDeepStrictEqual(a, record)).length, 1,
          `every ask record the main checkout state.json held before is in it exactly once (the move read a whole document, never {} from a half-written one): ${JSON.stringify(record)} in ${JSON.stringify(asked)}`);
      }
      assert.equal(asked.filter((a) => a?.sessionId === 'main-stop-session').length, 1, "the main checkout Stop hook's own ask record is in state.json exactly once");
    },
  });
});

test("AC-16103-4: the main checkout Stop hook in a session that already asked stays silent (exit 0) when it reads the main checkout's state.json while a worktree move is writing it", async (t) => {
  const w = await heldWorld('rcf-fbs231-lock-read-midwrite-stop-', { shape: 'both', clock: wholeSecond() });
  await hook(w.main, 'stop', 'main-earlier-session', 2);
  const before = ownAsked(w);
  const writer = startWatched(w.lane, ['feedback', 'list', '--all', '--json'], { race: w.race('writer', ['state-midwrite']) });
  reap(t, [writer]);
  await paused(w.ctrl, writer, 'state-midwrite');
  const reader = startWatched(w.main, hookArgs('stop'), { stdin: hookStdin('stop', 'main-earlier-session'), race: w.race('reader', []) });
  reap(t, [reader]);
  t.diagnostic(`the Stop hook ${await contendedOrExited(w.ctrl, reader)} while the move is held mid-write`);
  release(w.ctrl, writer, 'state-midwrite');
  assertRaceExit(await writer.result, w.main, 'rcf feedback list in the worktree (the move writing state.json)');
  const r = await reader.result;
  assert.equal(r.code, 0,
    `the Stop hook in a session that already asked reads a whole state.json and stays silent (exit 0), never failing on or re-asking from a half-written one\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  assert.equal(r.stderr, '', `the silent Stop hook writes nothing to stderr\nstderr:\n${r.stderr}`);
  await assertOutcome(w, {
    extra: () => {
      const asked = askedIn(storeOf(w.main));
      for (const record of before) {
        assert.equal(asked.filter((a) => isDeepStrictEqual(a, record)).length, 1,
          `every ask record the main checkout state.json held before is in it exactly once: ${JSON.stringify(record)}`);
      }
    },
  });
});

test("AC-16103-4: when the main checkout Stop hook writes its ask record while a worktree move is between its read and its write of the main checkout's state.json, the hook's own ask record and every held ask record are kept exactly once", async (t) => {
  const w = await heldWorld('rcf-fbs231-lock-stop-mid-move-', { shape: 'both', clock: wholeSecond() });
  const mover = startWatched(w.lane, ['feedback', 'list', '--all', '--json'], { race: w.race('mover', ['state-write']) });
  reap(t, [mover]);
  await paused(w.ctrl, mover, 'state-write');
  const stop = startWatched(w.main, hookArgs('stop'), { stdin: hookStdin('stop', 'main-stop-session'), race: w.race('stop', []) });
  reap(t, [stop]);
  t.diagnostic(`the Stop hook ${await contendedOrExited(w.ctrl, stop)} while the move is held`);
  release(w.ctrl, mover, 'state-write');
  assertRaceExit(await mover.result, w.main, 'rcf feedback list in the worktree (the held move)');
  const s = await stop.result;
  assert.equal(s.code, 2, `the main checkout Stop hook asks (exit 2) as it would alone\nstderr:\n${s.stderr}`);
  await assertOutcome(w, {
    extra: () => {
      const asked = askedIn(storeOf(w.main));
      assert.equal(asked.filter((a) => a?.sessionId === 'main-stop-session').length, 1,
        `the main checkout Stop hook's own ask record, written while the move ran, is in state.json exactly once (never lost to the move's rewrite): ${JSON.stringify(asked)}`);
    },
  });
});

test('AC-16103-4: while a worktree move is still changing the main checkout store, rcf feedback add, the Stop hook, the SessionEnd hook and rcf feedback submit in the main checkout each exit 1 once their wait runs out, naming the running command and the main checkout, and write nothing', async (t) => {
  const w = await heldWorld('rcf-fbs231-lock-wait-runs-out-', { shape: 'both', clock: wholeSecond() });
  const holder = startWatched(w.lane, ['feedback', 'list', '--all', '--json'], { race: w.race('holder', ['outbox-write']) });
  reap(t, [holder]);
  await paused(w.ctrl, holder, 'outbox-write');
  const mainStore = storeOf(w.main);
  const held = snapshot(mainStore);
  const wait = { RCF_FEEDBACK_LOCK_WAIT_MS: SHORT_WAIT_MS };
  const writers = [
    ['rcf feedback add', startWatched(w.main, ADD_ARGS('recorded while the move is held'), { env: wait })],
    ['the Stop hook', startWatched(w.main, hookArgs('stop'), { stdin: hookStdin('stop', 'main-wait-session'), env: wait })],
    ['the SessionEnd hook', startWatched(w.main, hookArgs('session-end'), { stdin: hookStdin('session-end', 'main-wait-session'), env: wait })],
    ['rcf feedback submit --yes', startWatched(w.main, ['feedback', 'submit', '--yes'], { path: NO_GH_PATH, env: wait })],
  ];
  reap(t, writers.map(([, h]) => h));
  const pid = String(holder.child.pid);
  for (const [label, h] of writers) {
    const r = await h.result;
    assert.equal(r.code, 1, `${label} in the main checkout exits 1 once its wait for the running move runs out\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    assert.ok(r.stderr.includes(pid), `${label} names the running command (process ${pid}) on stderr\nstderr:\n${r.stderr}`);
    assert.ok(namesDir(r.stderr, w.main), `${label} names the main checkout on stderr\nstderr:\n${r.stderr}`);
  }
  assert.deepEqual(snapshot(mainStore), held, 'a writer whose wait runs out writes nothing under the main checkout .rcf/feedback/ (nothing half-done)');
  release(w.ctrl, holder, 'outbox-write');
  assertRaceExit(await holder.result, w.main, 'rcf feedback list in the worktree (the held move)');
  await assertOutcome(w);
});

test('AC-16103-4 guard: a worktree move whose process stopped without finishing holds up no later command: the next rcf feedback command in the worktree completes the move with each id once, and rcf feedback add in the main checkout proceeds', async (t) => {
  const w = await heldWorld('rcf-fbs231-lock-stopped-mover-', { shape: 'both', clock: wholeSecond() });
  const holder = startWatched(w.lane, ['feedback', 'list', '--all', '--json'], { race: w.race('holder', ['outbox-write']) });
  reap(t, [holder]);
  await paused(w.ctrl, holder, 'outbox-write');
  await killHeld(holder);
  await assertOutcome(w);
  const r = await runWatched(w.main, ADD_ARGS('recorded after the stopped move'), { env: { RCF_FEEDBACK_LOCK_WAIT_MS: SHORT_WAIT_MS } });
  assert.equal(r.code, 0, `rcf feedback add in the main checkout proceeds (exit 0) after the stopped move\nstderr:\n${r.stderr}`);
  const id = recordedId(r);
  assert.ok(id, `rcf feedback add records an entry\nstdout:\n${r.stdout}`);
  assert.deepEqual(await listIn(w.main), sortPairs([...w.heldIds, ...w.ownIds, [id, 'pending']]),
    'rcf feedback list --all --json from the main checkout lists every id once with its status, the new entry pending');
});

test('AC-16103-4 guard: a worktree move that started more than 60 seconds earlier holds up no later command: rcf feedback add in the main checkout records its entry, and the next rcf feedback command in the worktree completes the move with each id once', async (t) => {
  const w = await heldWorld('rcf-fbs231-lock-old-mover-', { shape: 'both', clock: wholeSecond() });
  const holder = startWatched(w.lane, ['feedback', 'list', '--all', '--json'], { race: w.race('holder', ['outbox-write']), clock: w.clock });
  reap(t, [holder]);
  await paused(w.ctrl, holder, 'outbox-write');
  const later = new Date(Date.parse(w.clock) + 120_000).toISOString();
  const r = await runWatched(w.main, ADD_ARGS('recorded 120 seconds after the move started'), { clock: later, env: { RCF_FEEDBACK_LOCK_WAIT_MS: SHORT_WAIT_MS } });
  assert.equal(r.code, 0, `rcf feedback add in the main checkout proceeds (exit 0) past a move that started 120 seconds earlier\nstderr:\n${r.stderr}`);
  const id = recordedId(r);
  assert.ok(id, `rcf feedback add records an entry\nstdout:\n${r.stdout}`);
  await killHeld(holder);
  await assertOutcome(w, { expectedIds: sortPairs([...w.heldIds, ...w.ownIds, [id, 'pending']]) });
});
