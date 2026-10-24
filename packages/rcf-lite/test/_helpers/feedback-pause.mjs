// Test-side preload for the FBS-231 round 6 race tests (US-16103, US-16001).
// A child loads it with `node --import <this file> bin/rcf.js ...`. It never
// replaces, fakes or drops the result of a call: it only delays a real call
// at a named point until the fixture writes a release file, and it can pin
// the child's clock to a fixed instant. With none of the variables below set
// it does nothing.
//
//   RCF_TEST_PAUSE_DIR   the test's control directory (markers and releases)
//   RCF_TEST_PAUSE_ID    this child's id in the markers
//   RCF_TEST_BARRIER=1   hold the child before bin/rcf.js runs: write
//                        ready-<id> and wait for the file "go"
//   RCF_TEST_PAUSE_AT    comma list of pause points (each pauses once, the
//                        first time this child reaches it):
//     outbox-write  a call that writes a file into <main>/.rcf/feedback/outbox/
//     held-remove   a call that removes or renames a file under
//                   <held>/.rcf/feedback/
//     entries-write a call that writes <main>/.rcf/feedback/entries.jsonl
//     state-write   a call that writes <main>/.rcf/feedback/state.json
//   RCF_TEST_PAUSE_MAIN  the main checkout's directory (<main>)
//   RCF_TEST_PAUSE_HELD  the linked worktree's directory (<held>)
//   RCF_TEST_CLOCK       an ISO instant: new Date() and Date.now() return it
//
// At a pause point the child writes paused-<id>-<point> and blocks before the
// real call until release-<id>-<point> exists, then makes the call. A wait
// that runs out (RCF_TEST_PAUSE_LIMIT_MS, default 8000) writes
// timeout-<id>-<point> and exits 97, so the fixture fails on its own line.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { basename, dirname, join, resolve, sep } from 'node:path';

const env = process.env;
const real = {
  existsSync: fs.existsSync, realpathSync: fs.realpathSync, writeFileSync: fs.writeFileSync,
};

if (env.RCF_TEST_CLOCK) {
  const RealDate = Date;
  const fixed = RealDate.parse(env.RCF_TEST_CLOCK);
  if (!Number.isFinite(fixed)) throw new Error(`feedback-pause: RCF_TEST_CLOCK is not an instant: ${env.RCF_TEST_CLOCK}`);
  class PinnedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(fixed);
      else super(...args);
    }

    static now() { return fixed; }
  }
  globalThis.Date = PinnedDate;
}

const dir = env.RCF_TEST_PAUSE_DIR;
const id = env.RCF_TEST_PAUSE_ID ?? String(process.pid);
const limitMs = Number(env.RCF_TEST_PAUSE_LIMIT_MS ?? 8000);
const cell = new Int32Array(new SharedArrayBuffer(4));

function block(marker, release) {
  if (marker) real.writeFileSync(join(dir, marker), String(process.pid));
  const start = performance.now();
  while (!real.existsSync(join(dir, release))) {
    if (performance.now() - start > limitMs) {
      real.writeFileSync(join(dir, `timeout-${id}-${release}`), String(process.pid));
      process.exit(97);
    }
    Atomics.wait(cell, 0, 0, 2);
  }
}

if (dir && env.RCF_TEST_BARRIER === '1') block(`ready-${id}`, 'go');

const points = new Set((env.RCF_TEST_PAUSE_AT ?? '').split(',').map((s) => s.trim()).filter(Boolean));

// The real path of p, also when p does not exist yet (its nearest existing
// ancestor is resolved, so /var and /private/var compare equal on macOS).
function norm(p) {
  if (p === undefined || p === null || typeof p === 'number') return null;
  let d = resolve(p instanceof URL ? p.pathname : String(p));
  const rest = [];
  while (!real.existsSync(d)) {
    rest.unshift(basename(d));
    const up = dirname(d);
    if (up === d) return null;
    d = up;
  }
  return join(real.realpathSync(d), ...rest);
}

if (dir && points.size > 0) {
  const mainStore = env.RCF_TEST_PAUSE_MAIN ? join(norm(env.RCF_TEST_PAUSE_MAIN), '.rcf', 'feedback') : null;
  const heldStore = env.RCF_TEST_PAUSE_HELD ? join(norm(env.RCF_TEST_PAUSE_HELD), '.rcf', 'feedback') : null;
  const done = new Set();
  const within = (p, root) => p !== null && root !== null && p.startsWith(root + sep);
  const at = (point) => {
    if (!points.has(point) || done.has(point)) return;
    done.add(point);
    block(`paused-${id}-${point}`, `release-${id}-${point}`);
  };
  const writes = (target) => {
    const p = norm(target);
    if (mainStore !== null && p !== null) {
      if (within(p, join(mainStore, 'outbox'))) at('outbox-write');
      if (p === join(mainStore, 'entries.jsonl')) at('entries-write');
      if (p === join(mainStore, 'state.json')) at('state-write');
    }
  };
  const removes = (target) => {
    if (within(norm(target), heldStore)) at('held-remove');
  };
  const writeFlag = (flags) => (typeof flags === 'number'
    ? (flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_APPEND | fs.constants.O_TRUNC)) !== 0
    : /[wax+]/.test(String(flags ?? 'r')));
  const flagOf = (opts) => (typeof opts === 'object' && opts !== null ? opts.flag : undefined);
  const wrap = (obj, name, before) => {
    const original = obj[name];
    if (typeof original !== 'function') return;
    obj[name] = function paused(...args) {
      before(...args);
      return original.apply(this, args);
    };
  };
  for (const [obj, sync] of [[fs, true], [fsp, false]]) {
    const n = (base) => (sync ? `${base}Sync` : base);
    wrap(obj, n('writeFile'), (p, _d, opts) => { if (writeFlag(flagOf(opts) ?? 'w')) writes(p); });
    wrap(obj, n('appendFile'), (p) => writes(p));
    wrap(obj, n('copyFile'), (_s, d) => writes(d));
    wrap(obj, n('cp'), (_s, d) => writes(d));
    wrap(obj, n('link'), (_s, d) => writes(d));
    wrap(obj, n('symlink'), (_s, d) => writes(d));
    wrap(obj, n('open'), (p, flags) => { if (writeFlag(flags)) writes(p); });
    wrap(obj, n('rename'), (s, d) => { removes(s); writes(d); });
    wrap(obj, n('unlink'), (p) => removes(p));
    wrap(obj, n('rm'), (p) => removes(p));
  }
  syncBuiltinESMExports();
}
