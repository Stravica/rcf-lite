// Fixture side of the FBS-231 round 6 store-writer tests (run 2): starts
// `node bin/rcf.js` children that load the test-side preload
// test/_helpers/feedback-lock-pause.mjs (the injected pauses, including the
// state-midwrite point, the pinned clock and the contended-<id> marker), and
// waits on them. The worlds themselves (the held-queue world, the plain
// checkout, the outcome every concurrent path must leave) are the round 6
// helpers in test/_helpers/feedback-race-world.js, reused unchanged.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, '..', '..', 'bin', 'rcf.js');
const preload = pathToFileURL(join(here, 'feedback-lock-pause.mjs')).href;

const ISOLATED = {
  GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.com',
  GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.com',
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
};
const PLAIN_PATH = '/usr/bin:/bin';

// Every wait on a child is bounded well inside the 10 second test budget.
const WAIT_MS = 7000;

/**
 * The bound a writer waits for a command still changing the main
 * checkout's store, shortened for the tests that hold such a command past
 * it (the shipped bound is 10 seconds; a test cannot wait that long). The
 * build reads it from RCF_FEEDBACK_LOCK_WAIT_MS.
 */
export const SHORT_WAIT_MS = '750';

/**
 * Start `node --import feedback-lock-pause.mjs bin/rcf.js <args>` in cwd.
 * opts: stdin, path (PATH), clock (an ISO instant the child's clock is
 * pinned to), env (extra variables), and race (control dir, id, pause
 * points, barrier, main and held checkout directories).
 */
export function startWatched(cwd, args, opts = {}) {
  const env = { ...process.env, ...ISOLATED, CI: '1', PATH: opts.path ?? PLAIN_PATH };
  for (const k of ['RCF_FEEDBACK_DISABLE', 'RCF_FEEDBACK_ASK', 'RCF_FEEDBACK_SESSION_ID', 'RCF_FEEDBACK_LOCK_WAIT_MS', 'CLAUDECODE']) delete env[k];
  for (const k of Object.keys(env)) if (k.startsWith('RCF_TEST_')) delete env[k];
  Object.assign(env, opts.env ?? {});
  if (opts.clock) env.RCF_TEST_CLOCK = opts.clock;
  if (opts.race) {
    const { ctrl, id, at = [], barrier = false, main, held } = opts.race;
    Object.assign(env, { RCF_TEST_PAUSE_DIR: ctrl, RCF_TEST_PAUSE_ID: id, RCF_TEST_PAUSE_AT: at.join(',') });
    if (barrier) env.RCF_TEST_BARRIER = '1';
    if (main) env.RCF_TEST_PAUSE_MAIN = main;
    if (held) env.RCF_TEST_PAUSE_HELD = held;
  }
  const child = spawn(process.execPath, ['--import', preload, bin, ...args], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const h = { id: opts.race?.id ?? String(child.pid), child, exited: false, stdout: '', stderr: '', args };
  child.stdout.setEncoding('utf8').on('data', (d) => { h.stdout += d; });
  child.stderr.setEncoding('utf8').on('data', (d) => { h.stderr += d; });
  h.result = new Promise((res) => {
    child.on('close', (code, signal) => {
      h.exited = true;
      res({ code: code ?? (signal ? 128 : 1), signal, stdout: h.stdout, stderr: h.stderr });
    });
  });
  if (opts.stdin !== undefined) child.stdin.write(opts.stdin);
  child.stdin.end();
  return h;
}

export async function runWatched(cwd, args, opts = {}) {
  return startWatched(cwd, args, opts).result;
}

/**
 * Wait until the child has either found the main checkout's store busy (it
 * wrote contended-<id>: a create-only call there failed with EEXIST, so it is
 * waiting on the command the test holds) or exited. A wait that runs out
 * fails on this line.
 */
export async function contendedOrExited(ctrl, h) {
  const start = Date.now();
  for (;;) {
    if (existsSync(join(ctrl, `contended-${h.id}`))) return 'contended';
    if (h.exited) {
      assert.equal(readdirSync(ctrl).filter((f) => f.startsWith(`timeout-${h.id}-`)).length, 0,
        `fixture: no pause of ${h.id} ran out`);
      return 'exited';
    }
    assert.ok(Date.now() - start < WAIT_MS, `fixture: ${h.id} (${h.args.join(' ')}) found the store busy or exited within ${WAIT_MS} ms\nstderr:\n${h.stderr}`);
    await delay(5);
  }
}

/** Kill a held child with SIGKILL and wait until it has gone. */
export async function killHeld(h) {
  assert.equal(h.exited, false, `fixture: ${h.id} is still running when the test stops it`);
  h.child.kill('SIGKILL');
  const r = await h.result;
  assert.equal(r.signal, 'SIGKILL', `fixture: ${h.id} was stopped by SIGKILL`);
  return r;
}

/**
 * Wait until the child is held at the point (paused-<id>-<point>), has found
 * the main checkout's store busy (contended-<id>) or has exited. A wait that
 * runs out fails on this line.
 */
export async function pausedContendedOrExited(ctrl, h, point) {
  const start = Date.now();
  for (;;) {
    if (existsSync(join(ctrl, `paused-${h.id}-${point}`))) return 'paused';
    if (existsSync(join(ctrl, `contended-${h.id}`))) return 'contended';
    if (h.exited) {
      assert.equal(readdirSync(ctrl).filter((f) => f.startsWith(`timeout-${h.id}-`)).length, 0,
        `fixture: no pause of ${h.id} ran out`);
      return 'exited';
    }
    assert.ok(Date.now() - start < WAIT_MS, `fixture: ${h.id} (${h.args.join(' ')}) reached ${point}, found the store busy or exited within ${WAIT_MS} ms\nstderr:\n${h.stderr}`);
    await delay(5);
  }
}
