// Tests for issue #333 item 2 at the CLI wiring layer: without `--verbose`
// the chatty `log` sink is a noop, but the `logError` sink the CLI passes
// to `startServer` is unconditional and writes every line it receives to
// stderr. The pre-fix behaviour routed walker/watcher fatal lines through
// `log`, so a host that spawned `rcf audit view` without --verbose saw
// nothing when the watcher died. The server-level routing is covered by
// test/server/fatal-errors-logger.test.js; this file proves the CLI
// wires the two sinks correctly to stderr.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initProject } from '#core/store/init.js';
import { main as viewMain } from '../../src/cli/view.js';

function makeStartServerSpy() {
  const captured = { options: null };
  const fakeServer = {
    url: 'http://127.0.0.1:65535/',
    port: 65535,
    host: '127.0.0.1',
    close: async () => {},
    currentState: () => null,
    sse: { broadcast() {}, close() {}, drain: async () => {} },
    rewalk: async () => {},
  };
  async function startServerImpl(options) {
    captured.options = options;
    return fakeServer;
  }
  const handlers = {};
  function onSignal(sig, handler) { handlers[sig] = handler; }
  function trigger(sig = 'SIGINT') { if (handlers[sig]) handlers[sig](); }
  return { captured, startServerImpl, onSignal, trigger };
}

async function runCli(args, projectRoot) {
  const spy = makeStartServerSpy();
  const stderrBuf = [];
  const stdoutStream = { isTTY: false, write(_c) { return true; } };
  const stderrStream = { isTTY: false, write(c) { stderrBuf.push(c); return true; } };
  const run = viewMain(args, {
    env: { CI: '1' },
    stdout: stdoutStream,
    stderr: stderrStream,
    cwd: projectRoot,
    onSignal: spy.onSignal,
    startServerImpl: spy.startServerImpl,
  });
  // Give the CLI two microtask ticks to register its SIGINT handler, then
  // trigger the signal to drive main to resolution.
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  spy.trigger('SIGINT');
  const code = await run;
  return { code, options: spy.captured.options, readStderr: () => stderrBuf.join('') };
}

test('audit view wires log and logError sinks correctly for both --verbose states (issue #333 item 2)', async () => {
  const tmpA = await mkdtemp(join(tmpdir(), 'rcf-cli-fatal-a-'));
  await initProject({ projectRoot: tmpA });
  const nonVerbose = await runCli(['--port', '0', '--no-open'], tmpA);
  assert.ok(nonVerbose.options, 'startServer was called');
  assert.equal(typeof nonVerbose.options.log, 'function', 'log sink exists');
  assert.equal(typeof nonVerbose.options.logError, 'function', 'logError sink exists');
  // --verbose OFF: chatty log is a noop.
  nonVerbose.options.log('[chatty] per-event line that should stay hidden');
  assert.doesNotMatch(nonVerbose.readStderr(), /\[chatty\]/, 'chatty log drops without --verbose');
  // logError ALWAYS reaches stderr.
  nonVerbose.options.logError('[server] walker failed: boom');
  assert.match(nonVerbose.readStderr(), /\[server\] walker failed: boom/);

  const tmpB = await mkdtemp(join(tmpdir(), 'rcf-cli-fatal-b-'));
  await initProject({ projectRoot: tmpB });
  const verbose = await runCli(['--port', '0', '--no-open', '--verbose'], tmpB);
  // --verbose ON: chatty log reaches stderr too.
  verbose.options.log('[sse] write failed: client gone');
  assert.match(verbose.readStderr(), /\[sse\] write failed: client gone/);
  verbose.options.logError('[watch] watcher died');
  assert.match(verbose.readStderr(), /\[watch\] watcher died/);
});
