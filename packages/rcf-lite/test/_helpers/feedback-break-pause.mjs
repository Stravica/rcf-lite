// Test-side preload for the FBS-231 round 7 store tests (US-16103,
// AC-16103-4): loaded by a child only, through NODE_OPTIONS=--import beside
// test/_helpers/feedback-lock-pause.mjs (NODE_OPTIONS imports load first, so
// this file wraps the real fs calls and that one wraps these). Like its
// siblings it never replaces, fakes or drops the result of a call: it holds
// a real call at a named point until the fixture writes a release file,
// records what the child met, and can move the child's clock ahead. With
// none of the variables below set it does nothing.
//
//   RCF_TEST_PAUSE_DIR   the test's control directory (markers and releases)
//   RCF_TEST_PAUSE_ID    this child's id in the markers
//   RCF_TEST_PAUSE_MAIN  the main checkout's directory (<main>)
//   RCF_TEST_BREAK_AT    comma list of pause points (each pauses once):
//     lock-break       before the first call that destroys a file another
//                      command made under <main>/.rcf/feedback/ (none of the
//                      store's own files entries.jsonl, state.json, outbox/):
//                      an unlink, rm or rmdir of it, a rename of it away, a
//                      rename onto it, or a truncating write or copy over it.
//                      A stale hold is broken by such a call, whatever the
//                      hold's file, name or format, so a command held here
//                      has judged the hold it met stale and has not broken it
//     lock-broken      just after that call returns or throws
//     entries-midwrite a write of <main>/.rcf/feedback/entries.jsonl held
//                      between its start and its completion: an append or a
//                      truncating write is held once the first half of its
//                      bytes is in the file (the second half is then written
//                      by the real call, so the file ends with the same
//                      bytes); a replace by rename or link onto entries.jsonl
//                      is held before the rename (its new bytes are written
//                      elsewhere and the old file is still whole in place)
//   RCF_TEST_BREAK_READS=1  record partial-<id> when a read of
//                      <main>/.rcf/feedback/entries.jsonl returns bytes that
//                      do not end on a whole line, or a read of state.json
//                      returns bytes that are not a whole JSON document (the
//                      bytes are passed on unchanged)
//   RCF_TEST_CLOCK_AHEAD_MS, RCF_TEST_CLOCK_AHEAD_FILE  new Date() and
//                      Date.now() read the real clock plus the offset once
//                      the file exists (the clock moves ahead at once and
//                      keeps running)
//
// Markers (in RCF_TEST_PAUSE_DIR): paused-<id>-<point> at a pause, released
// by release-<id>-<point>; lockfile-<id> holds the path of the first file
// the child created with a create-only call under <main>/.rcf/feedback/
// that is none of the store's own files (the hold it took); polling-<id>
// once a create-only call on such a file has failed with EEXIST twice (the
// child is waiting on a hold another command has). A pause that runs out
// (RCF_TEST_PAUSE_LIMIT_MS, default 8000) writes timeout-<id>-<point> and
// exits 97, so the fixture fails on its own line.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { basename, dirname, join, resolve, sep } from 'node:path';

const env = process.env;
const real = {
  existsSync: fs.existsSync,
  realpathSync: fs.realpathSync,
  writeFileSync: fs.writeFileSync,
  appendFileSync: fs.appendFileSync,
};

if (env.RCF_TEST_CLOCK_AHEAD_MS && env.RCF_TEST_CLOCK_AHEAD_FILE) {
  const RealDate = Date;
  const ahead = Number(env.RCF_TEST_CLOCK_AHEAD_MS);
  const file = env.RCF_TEST_CLOCK_AHEAD_FILE;
  if (!Number.isFinite(ahead)) throw new Error(`feedback-break-pause: RCF_TEST_CLOCK_AHEAD_MS is not a number: ${env.RCF_TEST_CLOCK_AHEAD_MS}`);
  const nowMs = () => RealDate.now() + (real.existsSync(file) ? ahead : 0);
  class AheadDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(nowMs());
      else super(...args);
    }

    static now() { return nowMs(); }
  }
  globalThis.Date = AheadDate;
}

const dir = env.RCF_TEST_PAUSE_DIR;
const id = env.RCF_TEST_PAUSE_ID ?? String(process.pid);
const limitMs = Number(env.RCF_TEST_PAUSE_LIMIT_MS ?? 8000);
const cell = new Int32Array(new SharedArrayBuffer(4));
const points = new Set((env.RCF_TEST_BREAK_AT ?? '').split(',').map((s) => s.trim()).filter(Boolean));
const reads = env.RCF_TEST_BREAK_READS === '1';

function block(point) {
  real.writeFileSync(join(dir, `paused-${id}-${point}`), String(process.pid));
  const start = performance.now();
  while (!real.existsSync(join(dir, `release-${id}-${point}`))) {
    if (performance.now() - start > limitMs) {
      real.writeFileSync(join(dir, `timeout-${id}-${point}`), String(process.pid));
      process.exit(97);
    }
    Atomics.wait(cell, 0, 0, 2);
  }
}

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
  const entries = join(mainStore, 'entries.jsonl');
  const state = join(mainStore, 'state.json');
  const done = new Set();
  const mine = new Set();
  const eexist = new Map();
  let lockfile = false;
  let polling = false;
  let partial = false;
  let broke = false;
  const within = (p, root) => p !== null && root !== null && p.startsWith(root + sep);
  // A file under the main store that is none of the store's own files.
  const other = (p) => within(p, mainStore) && !within(p, mainOutbox) && p !== mainOutbox && p !== entries && p !== state;
  const at = (point) => {
    if (!points.has(point) || done.has(point)) return;
    done.add(point);
    block(point);
  };
  const created = (target, createOnly) => {
    const p = norm(target);
    if (p === null) return;
    mine.add(p);
    if (createOnly && !lockfile && other(p)) {
      lockfile = true;
      real.writeFileSync(join(dir, `lockfile-${id}`), resolve(String(target)));
    }
  };
  const failed = (target, err) => {
    if (err?.code !== 'EEXIST') return;
    const p = norm(target);
    if (!other(p)) return;
    const n = (eexist.get(p) ?? 0) + 1;
    eexist.set(p, n);
    if (n >= 2 && !polling) {
      polling = true;
      real.writeFileSync(join(dir, `polling-${id}`), p);
    }
  };
  // Another command's file under the main store, there now.
  const theirs = (target) => {
    const p = norm(target);
    return other(p) && !mine.has(p) && real.existsSync(p) ? p : null;
  };
  const truncFlag = (flags) => (typeof flags === 'number'
    ? (flags & fs.constants.O_TRUNC) !== 0 && (flags & fs.constants.O_EXCL) === 0
    : /^w/.test(String(flags ?? 'r')) && !/x/.test(String(flags)));
  const writeFlag = (flags) => (typeof flags === 'number'
    ? (flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_APPEND | fs.constants.O_TRUNC)) !== 0
    : /[wax+]/.test(String(flags ?? 'r')));
  const exclFlag = (flags) => (typeof flags === 'number' ? (flags & fs.constants.O_EXCL) !== 0 : /x/.test(String(flags ?? '')));
  const flagOf = (opts) => (typeof opts === 'object' && opts !== null ? opts.flag : undefined);
  const encodingOf = (opts) => (typeof opts === 'string' ? opts : (typeof opts === 'object' && opts?.encoding) || 'utf8');

  // wrap(obj, name, spec): spec.destroys(...args) -> true when the call
  // destroys another command's file; spec.target(...args) -> the path the
  // call creates or writes (recorded as the child's own on success);
  // spec.createOnly(...args) -> true for a create-only call (EEXIST is
  // recorded); spec.before(args) may hold the call and return new args.
  const wrap = (obj, name, spec) => {
    const original = obj[name];
    if (typeof original !== 'function') return;
    obj[name] = function held(...args) {
      const breaking = !broke && spec.destroys?.(...args);
      if (breaking) {
        broke = true;
        at('lock-break');
      }
      const call = spec.before ? spec.before(args) : args;
      const target = spec.target?.(...call) ?? null;
      const createOnly = spec.createOnly?.(...call) ?? false;
      const ok = () => { if (target !== null) created(target, createOnly); };
      const bad = (err) => { if (target !== null && createOnly) failed(target, err); };
      const after = () => { if (breaking) at('lock-broken'); };
      const cb = typeof call.at(-1) === 'function' ? call.length - 1 : -1;
      if (cb >= 0) {
        const doneCb = call[cb];
        call[cb] = function observed(err, ...rest) {
          if (err) bad(err); else ok();
          after();
          return doneCb.call(this, err, ...rest);
        };
        return original.apply(this, call);
      }
      let out;
      try {
        out = original.apply(this, call);
      } catch (err) {
        bad(err);
        after();
        throw err;
      }
      if (out && typeof out.then === 'function') {
        return out.then((v) => { ok(); after(); return v; }, (err) => { bad(err); after(); throw err; });
      }
      ok();
      after();
      return out;
    };
  };

  // entries-midwrite for a direct write: write the first half of the bytes
  // with the real call, hold, then let the real call write the rest (an
  // append) or all of it again (a truncating write, which ends with the
  // same bytes).
  const midwrite = (args, append) => {
    const p = norm(args[0]);
    if (p !== entries || !points.has('entries-midwrite') || done.has('entries-midwrite')) return args;
    const data = args[1];
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(String(data), encodingOf(args[2]));
    if (bytes.length < 2) return args;
    const half = Math.floor(bytes.length / 2);
    if (append) real.appendFileSync(args[0], bytes.subarray(0, half));
    else real.writeFileSync(args[0], bytes.subarray(0, half));
    at('entries-midwrite');
    if (!append) return args;
    const rest = [...args];
    rest[1] = bytes.subarray(half);
    if (typeof rest[2] === 'string') rest[2] = {};
    return rest;
  };
  const replaces = (d) => { if (norm(d) === entries) at('entries-midwrite'); };

  for (const [obj, sync] of [[fs, true], [fsp, false]]) {
    const n = (base) => (sync ? `${base}Sync` : base);
    wrap(obj, n('writeFile'), {
      destroys: (p, _d, opts) => truncFlag(flagOf(opts) ?? 'w') && theirs(p) !== null,
      before: (args) => (truncFlag(flagOf(args[2]) ?? 'w') ? midwrite(args, false) : args),
      target: (p) => p,
      createOnly: (_p, _d, opts) => exclFlag(flagOf(opts)),
    });
    wrap(obj, n('appendFile'), {
      before: (args) => midwrite(args, true),
      target: (p) => p,
      createOnly: (_p, _d, opts) => exclFlag(flagOf(opts)),
    });
    wrap(obj, n('copyFile'), {
      destroys: (_s, d, mode) => !(typeof mode === 'number' && (mode & fs.constants.COPYFILE_EXCL) !== 0) && theirs(d) !== null,
      target: (_s, d) => d,
      createOnly: (_s, _d, mode) => typeof mode === 'number' && (mode & fs.constants.COPYFILE_EXCL) !== 0,
    });
    wrap(obj, n('link'), {
      before: (args) => { replaces(args[1]); return args; },
      target: (_s, d) => d,
      createOnly: () => true,
    });
    wrap(obj, n('symlink'), { target: (_s, d) => d, createOnly: () => true });
    wrap(obj, n('rename'), {
      destroys: (s, d) => theirs(s) !== null || theirs(d) !== null,
      before: (args) => { replaces(args[1]); return args; },
      target: (_s, d) => d,
    });
    wrap(obj, n('open'), {
      destroys: (p, flags) => truncFlag(flags) && theirs(p) !== null,
      target: (p, flags) => (writeFlag(flags) ? p : null),
      createOnly: (_p, flags) => exclFlag(flags),
    });
    wrap(obj, n('mkdir'), {
      target: (p, opts) => (typeof opts === 'object' && opts?.recursive ? null : p),
      createOnly: (_p, opts) => !(typeof opts === 'object' && opts?.recursive),
    });
    for (const name of ['unlink', 'rm', 'rmdir']) wrap(obj, n(name), { destroys: (p) => theirs(p) !== null });
  }

  if (reads) {
    const look = (target, text) => {
      if (partial || text === undefined || text === null) return;
      const p = norm(target);
      const s = Buffer.isBuffer(text) ? text.toString('utf8') : String(text);
      let whole = true;
      if (p === entries) whole = s === '' || s.endsWith('\n');
      else if (p === state) {
        try { JSON.parse(s); } catch { whole = false; }
      } else return;
      if (!whole) {
        partial = true;
        real.writeFileSync(join(dir, `partial-${id}`), `${p}\n${s.slice(-200)}`);
      }
    };
    for (const [obj, sync] of [[fs, true], [fsp, false]]) {
      const name = sync ? 'readFileSync' : 'readFile';
      const original = obj[name];
      obj[name] = function read(...args) {
        const cb = typeof args.at(-1) === 'function' ? args.length - 1 : -1;
        if (cb >= 0) {
          const doneCb = args[cb];
          args[cb] = function seen(err, data) { if (!err) look(args[0], data); return doneCb.call(this, err, data); };
          return original.apply(this, args);
        }
        const out = original.apply(this, args);
        if (out && typeof out.then === 'function') return out.then((v) => { look(args[0], v); return v; });
        look(args[0], out);
        return out;
      };
    }
  }
  syncBuiltinESMExports();
}
