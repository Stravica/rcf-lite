// Test-side preload for the FBS-231 round 8 store tests (US-16103,
// AC-16103-4, decision 88): loaded by a child only, through NODE_OPTIONS
// after test/_helpers/feedback-break-pause.mjs (test/_helpers/feedback-fence-world.js,
// startFence), beside the run 2 preload test/_helpers/feedback-lock-pause.mjs.
// Like its siblings it never replaces, fakes or drops the result of a call:
// it holds a real call at a named point until the fixture writes a release
// file. With RCF_TEST_FENCE_AT unset it does nothing.
//
//   RCF_TEST_PAUSE_DIR   the test's control directory (markers and releases)
//   RCF_TEST_PAUSE_ID    this child's id in the markers
//   RCF_TEST_PAUSE_MAIN  the checkout whose .rcf/feedback/ store is watched (<main>)
//   RCF_TEST_FENCE_AT    comma list of pause points (each pauses once):
//     state-read           just after a read of <main>/.rcf/feedback/state.json
//                          returns (or fails: no ledger yet) while the child
//                          holds the store (below):
//                          it has read the ledger it is about to rewrite and
//                          has written none of it yet
//     retake-after-record  before a create-only call of a file under
//                          <main>/.rcf/feedback/ that is none of the store's
//                          own files (taking the store, or a claim on it),
//                          once the child has completed a write of
//                          entries.jsonl or state.json there whose new bytes
//                          contain RCF_TEST_FENCE_RECORD, while it holds
//                          nothing: it has recorded a filing, given the store
//                          up, and is about to take it again
//     waiting              just after a second create-only call on the same
//                          file under <main>/.rcf/feedback/ that is none of
//                          the store's own files has failed with EEXIST: the
//                          child is waiting on a hold or claim another
//                          command has, and holds the store no more than it
//                          did before it began to wait
//   RCF_TEST_FENCE_RECORD  the text a record of the filing carries (the
//                          filed issue's URL)
//
// "Holds the store": the child has made a file under <main>/.rcf/feedback/
// that is none of the store's own files (entries.jsonl, state.json,
// outbox/), with a create-only call (an exclusive writeFile, appendFile or
// open, a copyFile with COPYFILE_EXCL, a link or symlink, a mkdir without
// recursive) or a rename onto such a file, and has not removed it since (an
// unlink, rm or rename of it away). No file name, lock format or stale rule
// is named: a command that holds the store has some such file.
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
  readFileSync: fs.readFileSync,
};

const dir = env.RCF_TEST_PAUSE_DIR;
const id = env.RCF_TEST_PAUSE_ID ?? String(process.pid);
const limitMs = Number(env.RCF_TEST_PAUSE_LIMIT_MS ?? 8000);
const cell = new Int32Array(new SharedArrayBuffer(4));
const points = new Set((env.RCF_TEST_FENCE_AT ?? '').split(',').map((s) => s.trim()).filter(Boolean));
const record = env.RCF_TEST_FENCE_RECORD ?? '';

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

if (dir && env.RCF_TEST_PAUSE_MAIN && points.size > 0) {
  const mainStore = join(norm(env.RCF_TEST_PAUSE_MAIN), '.rcf', 'feedback');
  const mainOutbox = join(mainStore, 'outbox');
  const entries = join(mainStore, 'entries.jsonl');
  const state = join(mainStore, 'state.json');
  const done = new Set();
  const holds = new Set();
  let recorded = false;
  const within = (p, root) => p !== null && root !== null && p.startsWith(root + sep);
  const other = (p) => within(p, mainStore) && !within(p, mainOutbox) && p !== mainOutbox && p !== entries && p !== state;
  const at = (point) => {
    if (!points.has(point) || done.has(point)) return;
    done.add(point);
    block(point);
  };
  const exclFlag = (flags) => (typeof flags === 'number' ? (flags & fs.constants.O_EXCL) !== 0 : /x/.test(String(flags ?? '')));
  const flagOf = (opts) => (typeof opts === 'object' && opts !== null ? opts.flag : undefined);
  const encodingOf = (opts) => (typeof opts === 'string' ? opts : (typeof opts === 'object' && opts?.encoding) || 'utf8');
  const carries = (data, opts) => {
    if (record === '' || data === undefined || data === null) return false;
    const s = Buffer.isBuffer(data) ? data.toString('utf8') : typeof data === 'string' ? data : null;
    return s !== null ? s.includes(record) : Buffer.from(String(data), encodingOf(opts)).toString('utf8').includes(record);
  };
  const store = (p) => p === entries || p === state;
  const eexist = new Map();
  // A create-only call on another command's file that failed with EEXIST:
  // the second on the same file means the child is waiting on it.
  const refused = (_args, c, err) => {
    if (err?.code !== 'EEXIST' || !c?.excl || !other(c.p)) return;
    const k = (eexist.get(c.p) ?? 0) + 1;
    eexist.set(c.p, k);
    if (k >= 2) at('waiting');
  };
  const beforeCreate = (p) => {
    if (other(p) && recorded && holds.size === 0) at('retake-after-record');
  };

  // wrap(obj, name, spec): spec.before(args) runs before the real call;
  // spec.after(args) after it succeeds (sync, promise or callback);
  // spec.settled(args) after it returns or fails.
  const wrap = (obj, name, spec) => {
    const original = obj[name];
    if (typeof original !== 'function') return;
    obj[name] = function fenced(...args) {
      const ctx = spec.before ? spec.before(args) : undefined;
      const ok = (v) => { if (spec.after) spec.after(args, ctx, v); if (spec.settled) spec.settled(args, ctx); };
      const bad = (err) => { if (spec.failed) spec.failed(args, ctx, err); if (spec.settled) spec.settled(args, ctx); };
      const cb = typeof args.at(-1) === 'function' ? args.length - 1 : -1;
      if (cb >= 0) {
        const doneCb = args[cb];
        args[cb] = function observed(err, ...rest) {
          if (!err) ok(rest[0]); else bad(err);
          return doneCb.call(this, err, ...rest);
        };
        return original.apply(this, args);
      }
      let out;
      try {
        out = original.apply(this, args);
      } catch (err) {
        bad(err);
        throw err;
      }
      if (out && typeof out.then === 'function') return out.then((v) => { ok(v); return v; }, (err) => { bad(err); throw err; });
      ok(out);
      return out;
    };
  };

  for (const [obj, sync] of [[fs, true], [fsp, false]]) {
    const n = (base) => (sync ? `${base}Sync` : base);
    for (const name of ['writeFile', 'appendFile']) {
      wrap(obj, n(name), {
        before: (args) => {
          const p = norm(args[0]);
          const excl = exclFlag(flagOf(args[2]));
          if (excl) beforeCreate(p);
          return { p, excl, carries: store(p) && carries(args[1], args[2]) };
        },
        after: (_args, c) => {
          if (c.excl && other(c.p)) holds.add(c.p);
          if (c.carries) recorded = true;
        },
        failed: refused,
      });
    }
    wrap(obj, n('open'), {
      before: (args) => {
        const p = norm(args[0]);
        const excl = exclFlag(args[1]);
        if (excl) beforeCreate(p);
        return { p, excl };
      },
      after: (_args, c) => { if (c.excl && other(c.p)) holds.add(c.p); },
      failed: refused,
    });
    wrap(obj, n('copyFile'), {
      before: (args) => {
        const p = norm(args[1]);
        const excl = typeof args[2] === 'number' && (args[2] & fs.constants.COPYFILE_EXCL) !== 0;
        if (excl) beforeCreate(p);
        return { p, excl };
      },
      after: (_args, c) => { if (c.excl && other(c.p)) holds.add(c.p); },
      failed: refused,
    });
    for (const name of ['link', 'symlink']) {
      wrap(obj, n(name), {
        before: (args) => { const p = norm(args[1]); beforeCreate(p); return { p, excl: true }; },
        failed: refused,
        after: (_args, c) => { if (other(c.p)) holds.add(c.p); },
      });
    }
    wrap(obj, n('mkdir'), {
      before: (args) => {
        const p = norm(args[0]);
        const excl = !(typeof args[1] === 'object' && args[1]?.recursive);
        if (excl) beforeCreate(p);
        return { p, excl };
      },
      after: (_args, c) => { if (c.excl && other(c.p)) holds.add(c.p); },
      failed: refused,
    });
    wrap(obj, n('rename'), {
      before: (args) => {
        const s = norm(args[0]);
        const d = norm(args[1]);
        let carry = false;
        if (store(d) && record !== '') {
          try { carry = real.readFileSync(args[0], 'utf8').includes(record); } catch { carry = false; }
        }
        return { s, d, carry };
      },
      after: (_args, c) => {
        holds.delete(c.s);
        if (other(c.d)) holds.add(c.d);
        if (c.carry) recorded = true;
      },
    });
    for (const name of ['unlink', 'rm', 'rmdir']) {
      wrap(obj, n(name), {
        before: (args) => ({ p: norm(args[0]) }),
        after: (_args, c) => { holds.delete(c.p); },
      });
    }
    wrap(obj, sync ? 'readFileSync' : 'readFile', {
      before: (args) => ({ p: norm(args[0]) }),
      settled: (_args, c) => { if (c.p === state && holds.size > 0) at('state-read'); },
    });
  }
  syncBuiltinESMExports();
}
