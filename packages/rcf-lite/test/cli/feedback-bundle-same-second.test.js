// FBS-231 round 6: the two outbox bundle writers in one checkout, twice in
// the same second. The SessionEnd hook (US-16103, AC-16103-1) names its
// bundle from the time rounded to the second; submit's whole-destination
// bundle (US-16001, AC-16001-1, no gh on PATH) names it from the time and the
// repository slug. A second bundle with other content in the same second must
// be kept beside the first, never over it; a SessionEnd re-run with the same
// pending set still writes nothing new.
//
// Each test drives `node bin/rcf.js` as a child process in a plain checkout of
// a fixture project (no network, no agent CLI); the same second comes from
// the test-side preload test/_helpers/feedback-pause.mjs pinning each child's
// clock to one instant. The tests never assert the name a colliding bundle
// gets, only that neither bundle replaced the other.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import {
  addEntry, hook, listIn, namesHolding, outboxState, plainCheckout, snapshot, sortPairs, storeOf, submitToBundle,
  wholeSecond,
} from '../_helpers/feedback-race-world.js';

function outboxBytes(dir) {
  return Object.values(snapshot(join(storeOf(dir), 'outbox')));
}

function assertBothKept(dir, first, second, label) {
  assert.notEqual(first, second, `fixture: the two ${label} bundles differ`);
  const firstAt = namesHolding(storeOf(dir), first);
  assert.equal(firstAt.length, 1,
    `the first ${label} bundle is still in the outbox, byte-identical, in exactly one file (never overwritten by the second): [${firstAt.join(', ')}]`);
  const secondAt = namesHolding(storeOf(dir), second);
  assert.equal(secondAt.length, 1, `the second ${label} bundle is in the outbox in exactly one file: [${secondAt.join(', ')}]`);
  assert.equal(outboxBytes(dir).length, 2, `the outbox holds the two ${label} bundles and nothing else`);
}

test('AC-16103-1: two rcf feedback hook session-end runs in one checkout in the same second with different pending sets keep both bundles, neither overwriting the other', async () => {
  const dir = await plainCheckout('rcf-fbs231-same-second-hook-');
  const clock = wholeSecond();
  const a = await addEntry(dir, 'pending before the first SessionEnd', clock);
  await hook(dir, 'session-end', 'same-second-one', 0, clock);
  const first = outboxBytes(dir);
  assert.equal(first.length, 1, 'fixture: the first SessionEnd run writes one bundle');
  const b = await addEntry(dir, 'pending before the second SessionEnd', clock);
  await hook(dir, 'session-end', 'same-second-two', 0, clock);
  const second = outboxBytes(dir).filter((x) => x !== first[0]);
  assert.equal(second.length, 1, 'fixture: the second SessionEnd run wrote a bundle with other bytes');
  assertBothKept(dir, first[0], second[0], 'SessionEnd');
  assert.deepEqual(await listIn(dir), sortPairs([[a, 'pending'], [b, 'pending']]), 'rcf feedback list --all --json lists every entry once with its status');
});

test('AC-16103-1 guard: after two SessionEnd bundles in the same second, a third rcf feedback hook session-end run with the same pending set as the second writes nothing new', async () => {
  const dir = await plainCheckout('rcf-fbs231-same-second-idem-');
  const clock = wholeSecond();
  await addEntry(dir, 'pending before the first SessionEnd', clock);
  await hook(dir, 'session-end', 'same-second-one', 0, clock);
  await addEntry(dir, 'pending before the second SessionEnd', clock);
  await hook(dir, 'session-end', 'same-second-two', 0, clock);
  const before = outboxState(storeOf(dir));
  assert.ok(Object.keys(before).length >= 1, 'fixture: the outbox holds the SessionEnd bundles');
  await hook(dir, 'session-end', 'same-second-three', 0, clock);
  const after = outboxState(storeOf(dir));
  assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort(), 'the third run with the same pending set adds no file to the outbox');
  for (const [name, state] of Object.entries(before)) {
    assert.equal(after[name].bytes, state.bytes, `the third run leaves ${name} byte-identical`);
    assert.equal(after[name].mtimeMs, state.mtimeMs, `the third run does not rewrite ${name} (same content, no rewrite)`);
  }
});

test('AC-16001-1: two rcf feedback submit --yes runs without gh in one checkout in the same second, each bundling two entries to the same destination, keep both bundles, neither overwriting the other', async () => {
  const dir = await plainCheckout('rcf-fbs231-same-second-submit-');
  const clock = wholeSecond();
  const ids = [];
  ids.push(await addEntry(dir, 'bundled by the first submit (one)', clock));
  ids.push(await addEntry(dir, 'bundled by the first submit (two)', clock));
  await submitToBundle(dir, clock);
  const first = outboxBytes(dir);
  assert.equal(first.length, 1, 'fixture: the first submit writes one whole-destination bundle');
  ids.push(await addEntry(dir, 'bundled by the second submit (one)', clock));
  ids.push(await addEntry(dir, 'bundled by the second submit (two)', clock));
  await submitToBundle(dir, clock);
  const second = outboxBytes(dir).filter((x) => x !== first[0]);
  assert.equal(second.length, 1, 'fixture: the second submit wrote a bundle with other bytes');
  assertBothKept(dir, first[0], second[0], 'submit');
  assert.deepEqual(await listIn(dir), sortPairs(ids.map((id) => [id, 'bundled'])), 'rcf feedback list --all --json lists every entry once with status bundled');
});
