// Tests for issue #333 item 2: fatal watcher/walker exceptions always
// reach `logError` even when `log` (the --verbose-gated chatty sink) is
// a noop, so a host that spawned `rcf audit view` without --verbose can
// still see a dead watcher. The chatty per-event lines stay gated on
// `log`. For back-compat, a caller that passes only `log` keeps the
// pre-fix one-sink behaviour.

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
  const root = await mkdtemp(join(tmpdir(), 'rcf-fatal-log-'));
  await initProject({ projectRoot: root });
  return root;
}

function makeOkRender() {
  return () => Promise.resolve({
    fullPageHtml: '<!DOCTYPE html><html><body><div id="rcf-live-content"></div></body></html>',
    contentHtml: '<p>ok</p>',
    errors: [],
    pmPartials: {},
    indexJson: { nodes: {}, nodeIds: [] },
  });
}

/**
 * A controllable `watchImpl` that captures the `onError` handler so a
 * test can fire a watcher failure on demand without racing a real
 * fs.watch failure mode.
 */
function makeControllableWatch() {
  const captured = { onError: null, onChange: null, closeCalls: 0 };
  function watchImpl(args) {
    captured.onError = args.onError;
    captured.onChange = args.onChange;
    return { close: () => { captured.closeCalls += 1; } };
  }
  return { watchImpl, captured };
}

test('watcher onError surfaces to logError even when log is a noop (issue #333 item 2)', async () => {
  const root = await makeCleanProject();
  const chatty = [];
  const errors = [];
  const { watchImpl, captured } = makeControllableWatch();
  const srv = await startServer({
    projectRoot: root,
    port: await freePort(),
    log: (line) => { chatty.push(line); },
    logError: (line) => { errors.push(line); },
    watchImpl,
    renderImpl: makeOkRender(),
  });
  try {
    assert.equal(typeof captured.onError, 'function', 'server wired an onError');
    captured.onError(new Error('watcher died in the night'));
    assert.deepEqual(
      errors,
      ['[watch] watcher died in the night'],
      'watcher error reaches logError',
    );
    assert.deepEqual(chatty, [], 'watcher error does not pollute the chatty log');
  } finally {
    await srv.close();
  }
});

test('walker exception surfaces to logError even when log is a noop (issue #333 item 2)', async () => {
  const root = await makeCleanProject();
  const chatty = [];
  const errors = [];
  // Initial walk succeeds; subsequent walks throw.
  let callNumber = 0;
  const renderImpl = () => {
    callNumber += 1;
    if (callNumber === 1) {
      return Promise.resolve({
        fullPageHtml: '<!DOCTYPE html><html><body><div id="rcf-live-content"></div></body></html>',
        contentHtml: '',
        errors: [],
        pmPartials: {},
        indexJson: { nodes: {}, nodeIds: [] },
      });
    }
    return Promise.reject(new Error('walker tripped on disk'));
  };
  const srv = await startServer({
    projectRoot: root,
    port: await freePort(),
    log: (line) => { chatty.push(line); },
    logError: (line) => { errors.push(line); },
    renderImpl,
  });
  try {
    await srv.rewalk();
    assert.deepEqual(
      errors,
      ['[server] walker failed: walker tripped on disk'],
      'walker failure reaches logError',
    );
    assert.deepEqual(chatty, [], 'walker failure does not pollute the chatty log');
  } finally {
    await srv.close();
  }
});

test('back-compat: a caller that passes only log still sees fatal errors (issue #333 item 2)', async () => {
  // Before the fix, the server took a single `log` sink and routed both
  // chatty and fatal lines through it; a caller that passes only `log`
  // should keep that behaviour.
  const root = await makeCleanProject();
  const lines = [];
  const { watchImpl, captured } = makeControllableWatch();
  const srv = await startServer({
    projectRoot: root,
    port: await freePort(),
    log: (line) => { lines.push(line); },
    watchImpl,
    renderImpl: makeOkRender(),
  });
  try {
    captured.onError(new Error('legacy caller'));
    assert.deepEqual(
      lines,
      ['[watch] legacy caller'],
      'without logError, fatal lines land on log for back-compat',
    );
  } finally {
    await srv.close();
  }
});
