// Fixture side of the FBS-231 round 7 store tests (AC-16103-4): starts
// `node bin/rcf.js` children through test/_helpers/feedback-lock-world.js
// startWatched (the run 2 preload test/_helpers/feedback-lock-pause.mjs) with
// the round 7 preload test/_helpers/feedback-break-pause.mjs loaded beside it
// through NODE_OPTIONS, and waits on what they meet. The worlds are the
// round 6 helpers in test/_helpers/feedback-race-world.js, reused unchanged.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { startWatched } from './feedback-lock-world.js';

const here = dirname(fileURLToPath(import.meta.url));
const breakPreload = pathToFileURL(join(here, 'feedback-break-pause.mjs')).href;

/** The configurable gh fake with a hold after its first issue create. */
export const GH_HOLD = resolve(here, 'gh-fake-hold.mjs');

// Every wait on a child is bounded well inside the 10 second test budget.
const WAIT_MS = 7000;

/**
 * startWatched with the round 7 preload. opts as startWatched's, plus
 * breakAt (round 7 pause points), reads (record a partial read of the main
 * checkout's entries.jsonl or state.json) and ahead ({ ms, file }: the
 * child's clock moves ms ahead once file exists; pass a file that exists
 * for a clock that is ahead from the start).
 */
export function startBreak(cwd, args, opts = {}) {
  const { breakAt = [], reads = false, ahead, env: extra = {}, ...rest } = opts;
  const env = { ...extra, NODE_OPTIONS: `--import=${breakPreload}` };
  if (breakAt.length > 0) env.RCF_TEST_BREAK_AT = breakAt.join(',');
  if (reads) env.RCF_TEST_BREAK_READS = '1';
  if (ahead) Object.assign(env, { RCF_TEST_CLOCK_AHEAD_MS: String(ahead.ms), RCF_TEST_CLOCK_AHEAD_FILE: ahead.file });
  return startWatched(cwd, args, { ...rest, env });
}

/**
 * Wait until the child is held at one of the points (returns the point),
 * is waiting on a hold another command has (polling-<id>: returns
 * 'polling') or has exited ('exited'). A wait that runs out, or a pause of
 * the child that ran out, fails on this line.
 */
export async function heldPollingOrExited(ctrl, h, points) {
  const start = Date.now();
  for (;;) {
    for (const p of points) if (existsSync(join(ctrl, `paused-${h.id}-${p}`))) return p;
    if (existsSync(join(ctrl, `polling-${h.id}`))) return 'polling';
    if (h.exited) {
      assert.equal(readdirSync(ctrl).filter((f) => f.startsWith(`timeout-${h.id}-`)).length, 0,
        `fixture: no pause of ${h.id} ran out`);
      return 'exited';
    }
    assert.ok(Date.now() - start < WAIT_MS, `fixture: ${h.id} (${h.args.join(' ')}) reached ${points.join(' or ')}, waited on another command or exited within ${WAIT_MS} ms\nstderr:\n${h.stderr}`);
    await delay(5);
  }
}

/** The path of the hold the child took (lockfile-<id>), as it named it. */
export function holdOf(ctrl, h) {
  const p = join(ctrl, `lockfile-${h.id}`);
  assert.ok(existsSync(p), `fixture: ${h.id} took a hold of the main checkout store (a file it created there with a create-only call)`);
  return readFileSync(p, 'utf8');
}

/** The partial read the child recorded, or null. */
export function partialRead(ctrl, h) {
  const p = join(ctrl, `partial-${h.id}`);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

/** A file whose existence moves a child's clock ahead (see startBreak). */
export function aheadFile(ctrl, id, now = false) {
  const file = join(ctrl, `ahead-${id}`);
  if (now) writeFileSync(file, 'now');
  return file;
}

/**
 * The gh double for submit: the configurable fake with a hold after its
 * first create, its scenario and call log in the control directory.
 */
export function ghDouble(ctrl, name, scenario, { hold = false } = {}) {
  const config = join(ctrl, `gh-${name}-config.json`);
  const log = join(ctrl, `gh-${name}-log.jsonl`);
  writeFileSync(config, JSON.stringify(scenario));
  writeFileSync(log, '');
  const env = { RCF_FEEDBACK_GH_MODULE: GH_HOLD, RCF_FEEDBACK_GH_FAKE_CONFIG: config, RCF_FEEDBACK_GH_FAKE_LOG: log };
  if (hold) env.RCF_TEST_GH_HOLD = '1';
  return {
    env,
    calls: () => readFileSync(log, 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l)),
  };
}
