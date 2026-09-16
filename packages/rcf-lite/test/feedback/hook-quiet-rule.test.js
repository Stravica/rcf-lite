// FBS-184 slice 5 unit tests for the pure quiet-rule (design 3.5).
//
// Binds AC-16101-1: shouldAsk() walks the {opted-out, pending,
// asked, stop-hook-active, age, queue-state, carried-over, ask-now}
// table and returns 'ask' or 'silent' per the design's every-clause
// gate + any-trigger predicate. The table below covers every named
// row on that AC.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { shouldAsk, buildAskReason, buildCarryOverLine } from '../../src/feedback/hook.js';

/** Row helper: fill required fields with the pass-through defaults so
 *  a single row can flip one attribute at a time. */
function row(overrides = {}) {
  return {
    optedOut: false,
    pendingCount: 1,
    askedThisSession: false,
    stopHookActive: false,
    anyAskNow: false,
    newestPendingAgeMs: 0,
    quietMinutes: 15,
    queueComplete: false,
    anyCarriedOver: false,
    ...overrides,
  };
}

test('AC-16101-1: shouldAsk is silent when opted out (any source)', () => {
  assert.equal(shouldAsk(row({ optedOut: true, anyAskNow: true })), 'silent');
  assert.equal(shouldAsk(row({ optedOut: true, newestPendingAgeMs: 60 * 60 * 1000 })), 'silent');
  assert.equal(shouldAsk(row({ optedOut: true, anyCarriedOver: true })), 'silent');
});

test('AC-16101-1: shouldAsk is silent when no pending entries', () => {
  assert.equal(shouldAsk(row({ pendingCount: 0, anyAskNow: true })), 'silent');
  assert.equal(shouldAsk(row({ pendingCount: 0, queueComplete: true })), 'silent');
});

test('AC-16101-1: shouldAsk is silent when already asked this session', () => {
  assert.equal(shouldAsk(row({ askedThisSession: true, anyAskNow: true })), 'silent');
  assert.equal(shouldAsk(row({ askedThisSession: true, newestPendingAgeMs: 60 * 60 * 1000 })), 'silent');
});

test('AC-16101-1: shouldAsk is silent when stop_hook_active is true', () => {
  assert.equal(shouldAsk(row({ stopHookActive: true, anyAskNow: true })), 'silent');
});

test('AC-16101-1: shouldAsk is silent when every gate passes but no trigger fires', () => {
  // gates all pass; but no trigger: fresh entry, no ask-now, queue
  // reports nothing, entry recorded under the current session.
  assert.equal(shouldAsk(row({})), 'silent');
});

test('AC-16101-1: shouldAsk is ask when askNow fires and every gate passes', () => {
  assert.equal(shouldAsk(row({ anyAskNow: true })), 'ask');
});

test('AC-16101-1: shouldAsk is ask when the newest pending entry crosses quietMinutes', () => {
  assert.equal(shouldAsk(row({ newestPendingAgeMs: 14 * 60 * 1000 })), 'silent');
  assert.equal(shouldAsk(row({ newestPendingAgeMs: 15 * 60 * 1000 })), 'ask');
  assert.equal(shouldAsk(row({ newestPendingAgeMs: 60 * 60 * 1000 })), 'ask');
});

test('AC-16101-1: quietMinutes is operator-configurable (0 asks immediately)', () => {
  assert.equal(shouldAsk(row({ quietMinutes: 0, newestPendingAgeMs: 1 })), 'ask');
  assert.equal(shouldAsk(row({ quietMinutes: 60, newestPendingAgeMs: 15 * 60 * 1000 })), 'silent');
  assert.equal(shouldAsk(row({ quietMinutes: 60, newestPendingAgeMs: 60 * 60 * 1000 })), 'ask');
});

test('AC-16101-1: shouldAsk is ask when queueComplete is true', () => {
  assert.equal(shouldAsk(row({ queueComplete: true })), 'ask');
});

test('AC-16101-1: shouldAsk is ask when any pending entry is carried over from a prior session', () => {
  assert.equal(shouldAsk(row({ anyCarriedOver: true })), 'ask');
});

test('AC-16101-1: shouldAsk is total on missing / undefined ages', () => {
  assert.equal(shouldAsk(row({ newestPendingAgeMs: null })), 'silent');
  assert.equal(shouldAsk(row({ newestPendingAgeMs: null, anyAskNow: true })), 'ask');
});

test('AC-16101-2: buildAskReason names the four next-step verbs and the do-not-ask clause', () => {
  const one = buildAskReason(1);
  assert.match(one, /rcf feedback preview/);
  assert.match(one, /rcf feedback submit --yes/);
  assert.match(one, /rcf feedback defer/);
  assert.match(one, /rcf feedback opt-out/);
  assert.match(one, /Do not ask again this session\./);
  assert.match(one, /1 unsubmitted entry/);
  const two = buildAskReason(2);
  assert.match(two, /2 unsubmitted entries/);
});

test('AC-16103-2: buildCarryOverLine says how many entries and cites RULE 17', () => {
  assert.match(buildCarryOverLine(1), /1 unsubmitted entry.+RULE 17/);
  assert.match(buildCarryOverLine(3), /3 unsubmitted entries.+RULE 17/);
});
