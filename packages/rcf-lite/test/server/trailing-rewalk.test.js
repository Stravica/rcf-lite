// Tests for issue #333 item 1: a change that arrives while a rewalk is in
// flight queues exactly one trailing rewalk that runs after the in-flight
// walk settles. Any number of coalesced calls land on the same trailing
// walk; the final on-disk state wins. The pre-fix behaviour silently
// dropped the change until a later, uncoalesced event arrived.
//
// The real walker (`renderModelToPage`) races disk I/O; these tests
// drive the server with an injected `renderImpl` whose promises resolve
// on demand so each walk's lifetime is observable.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initProject } from '#core/store/init.js';
import { startServer } from '../../src/server/index.js';

async function freePort() {
  return await new Promise((resolveP, rejectP) => {
    const s = createServer();
    s.on('error', rejectP);
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port;
      s.close(() => resolveP(port));
    });
  });
}

async function makeCleanProject() {
  const root = await mkdtemp(join(tmpdir(), 'rcf-trailing-rewalk-'));
  await initProject({ projectRoot: root });
  return root;
}

/**
 * A `renderImpl` fake that hands back a controllable promise for each
 * call. Tests resolve them one at a time to observe how the server
 * orders its walks.
 */
function makeControllableRender(seed = () => ({
  fullPageHtml: '<!DOCTYPE html><html><body><div id="rcf-live-content"></div></body></html>',
  contentHtml: '<p>ok</p>',
  errors: [],
  pmPartials: {},
  indexJson: { nodes: {}, nodeIds: [] },
})) {
  const calls = [];
  function renderImpl(_args) {
    let settle;
    const promise = new Promise((resolve, reject) => {
      settle = { resolve: (v = seed()) => resolve(v), reject };
    });
    calls.push({ promise, settle });
    return promise;
  }
  return { renderImpl, calls };
}

test('rewalk coalesces concurrent calls onto a single trailing walk (issue #333 item 1)', async () => {
  const root = await makeCleanProject();
  const { renderImpl, calls } = makeControllableRender();
  // startServer awaits the initial walk, so we have to resolve that one
  // before `startServer` returns. Schedule the resolution on the next
  // microtask so `calls[0]` has been registered when it runs.
  const started = startServer({ projectRoot: root, port: await freePort(), renderImpl });
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.length, 1, 'initial walk is in flight before startServer resolves');
  calls[0].settle.resolve();
  const srv = await started;
  try {
    assert.equal(srv.currentState().version, 1, 'initial walk bumps to v1');

    // Trigger a walk; before it resolves, call rewalk twice more.
    const first = srv.rewalk();
    await new Promise((r) => setImmediate(r));
    assert.equal(calls.length, 2, 'first rewalk is in flight');

    const concurrentA = srv.rewalk();
    const concurrentB = srv.rewalk();
    await new Promise((r) => setImmediate(r));
    assert.equal(
      calls.length,
      2,
      'concurrent calls do not launch new walks while one is in flight',
    );

    // Resolve the first in-flight walk. The trailing walk fires once.
    calls[1].settle.resolve();
    await first;
    await new Promise((r) => setImmediate(r));
    assert.equal(
      calls.length,
      3,
      'exactly one trailing walk kicks off after the in-flight walk settles',
    );

    // Resolve the trailing walk. Both concurrent callers resolve against it.
    calls[2].settle.resolve();
    await Promise.all([concurrentA, concurrentB]);

    // Three walks ran total: initial, in-flight, one trailing (not two).
    assert.equal(calls.length, 3, 'no extra walks after coalesced trailing');
    assert.equal(srv.currentState().version, 3, 'version bumps once per completed walk');
  } finally {
    await srv.close();
  }
});

test('rewalk during the trailing walk queues one more walk after it (issue #333 item 1)', async () => {
  const root = await makeCleanProject();
  const { renderImpl, calls } = makeControllableRender();
  const started = startServer({ projectRoot: root, port: await freePort(), renderImpl });
  await new Promise((r) => setImmediate(r));
  calls[0].settle.resolve();
  const srv = await started;
  try {
    // Walk A (the in-flight walk)
    const callA = srv.rewalk();
    await new Promise((r) => setImmediate(r));
    assert.equal(calls.length, 2);

    // Request a trailing walk B
    const callB = srv.rewalk();
    await new Promise((r) => setImmediate(r));
    assert.equal(calls.length, 2, 'B is queued, not launched');

    // Resolve A so B launches
    calls[1].settle.resolve();
    await callA;
    await new Promise((r) => setImmediate(r));
    assert.equal(calls.length, 3, 'B is now in flight');

    // During B, request a trailing walk C.
    const callC = srv.rewalk();
    await new Promise((r) => setImmediate(r));
    assert.equal(calls.length, 3, 'C is queued behind B');

    // Resolve B. C launches.
    calls[2].settle.resolve();
    await callB;
    await new Promise((r) => setImmediate(r));
    assert.equal(calls.length, 4, 'C launches after B settles');

    // Resolve C.
    calls[3].settle.resolve();
    await callC;

    // Four walks total: initial + A + B + C. No walk was dropped.
    assert.equal(calls.length, 4, 'no extra walks');
    assert.equal(srv.currentState().version, 4);
  } finally {
    await srv.close();
  }
});

test('rewalk during no walk launches a fresh walk, uncoalesced (issue #333 item 1)', async () => {
  const root = await makeCleanProject();
  const { renderImpl, calls } = makeControllableRender();
  const started = startServer({ projectRoot: root, port: await freePort(), renderImpl });
  await new Promise((r) => setImmediate(r));
  calls[0].settle.resolve();
  const srv = await started;
  try {
    // Walk A completes.
    const callA = srv.rewalk();
    await new Promise((r) => setImmediate(r));
    calls[1].settle.resolve();
    await callA;

    // Now kick off walk B after A has fully settled.
    const callB = srv.rewalk();
    await new Promise((r) => setImmediate(r));
    assert.equal(calls.length, 3, 'walk B is in flight; it is not blocked by A');

    calls[2].settle.resolve();
    await callB;
    assert.equal(srv.currentState().version, 3);
  } finally {
    await srv.close();
  }
});
