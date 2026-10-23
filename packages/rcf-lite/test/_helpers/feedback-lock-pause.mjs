// Test-side preload for the FBS-231 round 6 store-writer tests (US-16103,
// US-16101): the run 2 sibling of test/_helpers/feedback-pause.mjs, loaded by
// a child only, with `node --import <this file> bin/rcf.js ...`. Like that
// file it never replaces, fakes or drops the result of a call: it delays a
// real call at a named point until the fixture writes a release file, it can
// pin the child's clock to a fixed instant, and it can record that a call
// failed (the error is passed on unchanged). With none of the variables below
// set it does nothing.
//
//   RCF_TEST_PAUSE_DIR   the test's control directory (markers and releases)
//   RCF_TEST_PAUSE_ID    this child's id in the markers
//   RCF_TEST_BARRIER=1   hold the child before bin/rcf.js runs: write
//                        ready-<id> and wait for the file "go"
//   RCF_TEST_PAUSE_MAIN  the main checkout's directory (<main>)
//   RCF_TEST_PAUSE_HELD  the linked worktree's directory (<held>)
//   RCF_TEST_PAUSE_AT    comma list of pause points (each pauses once, the
//                        first time this child reaches it):
//     outbox-write   a call that writes a file into <main>/.rcf/feedback/outbox/
//     held-remove    a call that removes or renames a file under
//                    <held>/.rcf/feedback/
//     entries-write  a call that writes <main>/.rcf/feedback/entries.jsonl
//     state-write    a call that writes <main>/.rcf/feedback/state.json
//                    (held before the call)
//     state-midwrite the same call, held between the start of the write and
//                    its completion: a direct write of state.json (writeFile,
//                    or an open for writing) is held after the file has been
//                    opened for writing, which truncates it, and before its
//                    bytes are written (the window every plain writeFile
//                    has); a replace by rename or link onto state.json is
//                    held before the rename (its new bytes are written
//                    elsewhere and the old file is still whole in place)
//   RCF_TEST_CLOCK       an ISO instant: new Date() and Date.now() return it
//
// When RCF_TEST_PAUSE_DIR and RCF_TEST_PAUSE_MAIN are set, the child writes
// contended-<id> once when it meets a file another command made in
// <main>/.rcf/feedback/ that is none of the store's own files (entries.jsonl,
// state.json, outbox/): a create-only call there (an open, writeFile or
// appendFile with the exclusive flag, a copyFile with COPYFILE_EXCL, a link
// or symlink, a mkdir without recursive) that fails with EEXIST, or an
// exists, stat, access, read or open for reading there that finds the file.
// The call and its result or error are passed on unchanged.
//
// At a pause point the child writes paused-<id>-<point> and blocks until
// release-<id>-<point> exists. A wait that runs out (RCF_TEST_PAUSE_LIMIT_MS,
// default 8000) writes timeout-<id>-<point> and exits 97, so the fixture
// fails on its own line.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { basename, dirname, join, resolve, sep } from 'node:path';

const env = process.env;
const real = {
  existsSync: fs.existsSync,
  realpathSync: fs.realpathSync,
  writeFileSync: fs.writeFileSync,
  openSync: fs.openSync,
  closeSync: fs.closeSync,
};

if (env.RCF_TEST_CLOCK) {
  const RealDate = Date;
  const fixed = RealDate.parse(env.RCF_TEST_CLOCK);
  if (!Number.isFinite(fixed)) throw new Error(`feedback-lock-pause: RCF_TEST_CLOCK is not an instant: ${env.RCF_TEST_CLOCK}`);
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
  if (p === undefined || p === null || typeof p === 'number' || typeof p === 'object' && !(p instanceof URL) && !Buffer.isBuffer(p)) return null;
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

if (dir && env.RCF_TEST_PAUSE_MAIN) {
  const mainStore = join(norm(env.RCF_TEST_PAUSE_MAIN), '.rcf', 'feedback');
  const mainOutbox = join(mainStore, 'outbox');
  const statePath = join(mainStore, 'state.json');
  const heldStore = env.RCF_TEST_PAUSE_HELD ? join(norm(env.RCF_TEST_PAUSE_HELD), '.rcf', 'feedback') : null;
  const done = new Set();
  const within = (p, root) => p !== null && root !== null && p.startsWith(root + sep);
  const at = (point) => {
    if (!points.has(point) || done.has(point)) return false;
    done.add(point);
    block(`paused-${id}-${point}`, `release-${id}-${point}`);
    return true;
  };
  // kind: 'write' (a direct write, truncating or appending), 'open' (an open
  // for writing) or 'replace' (rename or link onto the target).
  const writes = (target, kind) => {
    const p = norm(target);
    if (p === null) return;
    if (within(p, mainOutbox)) at('outbox-write');
    if (p === join(mainStore, 'entries.jsonl')) at('entries-write');
    if (p === statePath) {
      at('state-write');
      if (points.has('state-midwrite') && !done.has('state-midwrite')) {
        if (kind === 'replace') {
          at('state-midwrite');
        } else if (kind === 'write') {
          // The first step of a plain writeFile is its open for writing,
          // which truncates the file; that step is made here, then the
          // child is held, then the real call writes the bytes.
          real.closeSync(real.openSync(p, 'w'));
          at('state-midwrite');
        }
      }
    }
  };
  const removes = (target) => {
    if (within(norm(target), heldStore)) at('held-remove');
  };
  let contended = false;
  const other = (target) => {
    const p = norm(target);
    return within(p, mainStore) && !within(p, mainOutbox) && p !== mainOutbox
      && p !== statePath && p !== join(mainStore, 'entries.jsonl');
  };
  const mark = () => {
    contended = true;
    real.writeFileSync(join(dir, `contended-${id}`), String(process.pid));
  };
  const contend = (target, err) => {
    if (!contended && err?.code === 'EEXIST' && other(target)) mark();
  };
  const found = (target) => {
    if (!contended && other(target)) mark();
  };
  // observe(obj, name): after a call that succeeds (existsSync true), on a
  // path that is none of the store's own files, mark contended.
  const observe = (obj, name, readOnly) => {
    const original = obj[name];
    if (typeof original !== 'function') return;
    obj[name] = function observed(...args) {
      if (readOnly && !readOnly(...args)) return original.apply(this, args);
      const cb = typeof args.at(-1) === 'function' ? args.length - 1 : -1;
      if (cb >= 0) {
        const done = args[cb];
        args[cb] = function seen(err, ...rest) { if (!err) found(args[0]); return done.call(this, err, ...rest); };
        return original.apply(this, args);
      }
      const out = original.apply(this, args);
      if (out && typeof out.then === 'function') return out.then((v) => { found(args[0]); return v; });
      if (name !== 'existsSync' || out === true) found(args[0]);
      return out;
    };
  };
  const writeFlag = (flags) => (typeof flags === 'number'
    ? (flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_APPEND | fs.constants.O_TRUNC)) !== 0
    : /[wax+]/.test(String(flags ?? 'r')));
  const exclFlag = (flags) => (typeof flags === 'number'
    ? (flags & fs.constants.O_EXCL) !== 0
    : /x/.test(String(flags ?? '')));
  const truncFlag = (flags) => (typeof flags === 'number'
    ? (flags & fs.constants.O_TRUNC) !== 0
    : /^w/.test(String(flags ?? 'r')));
  const flagOf = (opts) => (typeof opts === 'object' && opts !== null ? opts.flag : undefined);
  // wrap(obj, name, before, createOnly): before(...args) runs before the real
  // call; createOnly(...args) returns the path when the call is create-only,
  // so an EEXIST from it is recorded (sync throw, rejected promise or
  // callback error), then passed on unchanged.
  const wrap = (obj, name, before, createOnly) => {
    const original = obj[name];
    if (typeof original !== 'function') return;
    obj[name] = function paused(...args) {
      before(...args);
      const target = createOnly ? createOnly(...args) : null;
      if (target === null || target === undefined) return original.apply(this, args);
      const cb = typeof args.at(-1) === 'function' ? args.length - 1 : -1;
      if (cb >= 0) {
        const done = args[cb];
        args[cb] = function observed(err, ...rest) { contend(target, err); return done.call(this, err, ...rest); };
        return original.apply(this, args);
      }
      let out;
      try {
        out = original.apply(this, args);
      } catch (err) {
        contend(target, err);
        throw err;
      }
      if (out && typeof out.then === 'function') {
        return out.then((v) => v, (err) => { contend(target, err); throw err; });
      }
      return out;
    };
  };
  for (const [obj, sync] of [[fs, true], [fsp, false]]) {
    const n = (base) => (sync ? `${base}Sync` : base);
    wrap(obj, n('writeFile'),
      (p, _d, opts) => { const f = flagOf(opts) ?? 'w'; if (writeFlag(f)) writes(p, truncFlag(f) && !exclFlag(f) ? 'write' : 'open'); },
      (p, _d, opts) => (exclFlag(flagOf(opts)) ? p : null));
    wrap(obj, n('appendFile'), (p) => writes(p, 'open'), (p, _d, opts) => (exclFlag(flagOf(opts)) ? p : null));
    wrap(obj, n('copyFile'), (_s, d, mode) => writes(d, typeof mode === 'number' && (mode & fs.constants.COPYFILE_EXCL) !== 0 ? 'open' : 'write'),
      (_s, d, mode) => (typeof mode === 'number' && (mode & fs.constants.COPYFILE_EXCL) !== 0 ? d : null));
    wrap(obj, n('cp'), (_s, d) => writes(d, 'write'));
    wrap(obj, n('link'), (_s, d) => writes(d, 'replace'), (_s, d) => d);
    wrap(obj, n('symlink'), (_s, d) => writes(d, 'replace'), (_s, d) => d);
    wrap(obj, n('open'),
      (p, flags) => { if (writeFlag(flags)) writes(p, truncFlag(flags) && !exclFlag(flags) ? 'write' : 'open'); },
      (p, flags) => (exclFlag(flags) ? p : null));
    wrap(obj, n('mkdir'), () => {}, (p, opts) => (typeof opts === 'object' && opts?.recursive ? null : p));
    wrap(obj, n('rename'), (s, d) => { removes(s); writes(d, 'replace'); });
    wrap(obj, n('unlink'), (p) => removes(p));
    wrap(obj, n('rm'), (p) => removes(p));
  }
  observe(fs, 'existsSync');
  for (const [obj, sync] of [[fs, true], [fsp, false]]) {
    const n = (base) => (sync ? `${base}Sync` : base);
    for (const name of ['stat', 'lstat', 'access', 'readFile']) observe(obj, n(name));
    observe(obj, n('open'), (_p, flags) => !writeFlag(flags));
  }
  syncBuiltinESMExports();
}
