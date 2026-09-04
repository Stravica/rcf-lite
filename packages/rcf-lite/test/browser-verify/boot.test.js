// Unit tests for the boot fallback that consumes pack.boot and brings a
// dev server up when the runtime URL is unreachable. Every wait is
// injected (fake clock / fake fetch / fake spawn) so no real process or
// socket is opened here; the live boot-command path is covered in the
// server-down + boot live run captured in the PR body.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import {
  bootIfNeeded,
  isReachable,
  matchesSnapshot,
  pickBootFromPacks,
} from '../../src/browser-verify/boot.js';

function makeFakeFetch(script) {
  // script is an array of { status } or { throws: true }; the fake steps
  // through it in order and repeats the last entry.
  let i = 0;
  return async () => {
    const step = script[Math.min(i, script.length - 1)];
    i += 1;
    if (step && step.throws) throw new Error('network down');
    return { status: step?.status ?? 200 };
  };
}

function makeFakeSpawn() {
  const emitters = [];
  const spawnFn = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.exitCode = null;
    child.kill = (sig) => {
      child.killed = sig;
      // Fake child exits immediately on the first signal so the stop
      // path never falls through to SIGKILL in tests.
      setImmediate(() => { child.exitCode = 0; child.emit('exit', 0, sig); });
    };
    emitters.push(child);
    return child;
  };
  return { spawnFn, emitters };
}

test('pickBootFromPacks returns the first pack.boot present, ignoring null and missing entries', () => {
  const packs = [
    { boot: null },
    { boot: { bootCommand: 'node app.mjs', waitForUrl: 'http://127.0.0.1:5173' } },
    { boot: { bootCommand: 'unused' } },
  ];
  const chosen = pickBootFromPacks(packs);
  assert.ok(chosen);
  assert.equal(chosen.bootCommand, 'node app.mjs');
});

test('pickBootFromPacks returns null for empty / non-array inputs', () => {
  assert.equal(pickBootFromPacks([]), null);
  assert.equal(pickBootFromPacks(null), null);
  assert.equal(pickBootFromPacks(undefined), null);
});

test('isReachable returns true for any HTTP-shaped response (even a 404)', async () => {
  const fetchFn = makeFakeFetch([{ status: 404 }]);
  assert.equal(await isReachable('http://127.0.0.1:1234', fetchFn), true);
});

test('isReachable returns false when fetch throws / server is not listening', async () => {
  const fetchFn = makeFakeFetch([{ throws: true }]);
  assert.equal(await isReachable('http://127.0.0.1:1234', fetchFn), false);
});

test('isReachable returns false for empty / non-string URLs (defensive)', async () => {
  const fetchFn = async () => ({ status: 200 });
  assert.equal(await isReachable('', fetchFn), false);
  assert.equal(await isReachable(null, fetchFn), false);
});

test('bootIfNeeded short-circuits to already-up when the URL responds', async () => {
  const outcome = await bootIfNeeded({
    boot: { bootCommand: 'unused', waitForUrl: 'http://127.0.0.1:5173' },
    runtimeUrl: 'http://127.0.0.1:5173',
    projectRoot: '/tmp/nope',
    fetch: makeFakeFetch([{ status: 200 }]),
  });
  assert.equal(outcome.started, false);
  assert.equal(outcome.source, 'already-up');
  assert.match(outcome.notes.join('\n'), /already reachable/);
});

test('bootIfNeeded returns no-boot when the pack declares no boot block', async () => {
  const outcome = await bootIfNeeded({
    boot: null,
    runtimeUrl: 'http://127.0.0.1:5173',
    projectRoot: '/tmp/nope',
    fetch: makeFakeFetch([{ throws: true }]),
  });
  assert.equal(outcome.started, false);
  assert.equal(outcome.source, 'no-boot');
});

test('bootIfNeeded returns no-boot-command when boot is declared but bootCommand is missing', async () => {
  const outcome = await bootIfNeeded({
    boot: { waitForUrl: 'http://127.0.0.1:5173' },
    runtimeUrl: 'http://127.0.0.1:5173',
    projectRoot: '/tmp/nope',
    fetch: makeFakeFetch([{ throws: true }, { throws: true }]),
  });
  assert.equal(outcome.started, false);
  assert.equal(outcome.source, 'no-boot-command');
});

test('bootIfNeeded spawns bootCommand, polls until waitForUrl responds, then reports started', async () => {
  const { spawnFn, emitters } = makeFakeSpawn();
  // First reachability probe: down. Then the boot loop polls with the
  // same reachability check; script keeps returning "throws" until the
  // second poll flips to a live status.
  const fetchScript = [
    { throws: true }, // pre-check
    { throws: true }, // first poll after spawn
    { status: 200 },  // second poll: up
  ];
  const fetchFn = makeFakeFetch(fetchScript);
  const nowSeq = [0, 100, 200, 300, 400];
  let step = 0;
  const outcome = await bootIfNeeded({
    boot: { bootCommand: 'node app.mjs', waitForUrl: 'http://127.0.0.1:5173' },
    runtimeUrl: 'http://127.0.0.1:5173',
    projectRoot: '/tmp/nope',
    fetch: fetchFn,
    logger: () => {},
    now: () => nowSeq[Math.min(step++, nowSeq.length - 1)],
    timeouts: { urlMs: 5000, selectorMs: 1000, reachableProbeMs: 50 },
    spawnFn,
  });
  assert.equal(outcome.started, true);
  assert.equal(outcome.source, 'boot-command');
  assert.equal(emitters.length, 1);
  await outcome.stop();
  assert.equal(emitters[0].killed, 'SIGTERM');
});

test('matchesSnapshot matches raw substring, an aria role selector, and a bracketed hint', () => {
  const snap = 'main "Grid Shell"\n  grid\n    row "Alpha"\n    row "Bravo"';
  assert.equal(matchesSnapshot(snap, 'Grid Shell'), true);
  assert.equal(matchesSnapshot(snap, '[role="grid"]'), true);
  assert.equal(matchesSnapshot(snap, 'Charlie'), false);
});
