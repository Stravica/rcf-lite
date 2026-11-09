// The path normaliser of two feedback store preloads,
// test/_helpers/feedback-lock-pause.mjs and
// test/_helpers/feedback-break-pause.mjs, when the path it resolves goes
// between its two calls. Each preload resolves the path a wrapped fs call
// names with norm(): existsSync walks up to the nearest path that exists,
// then realpathSync resolves it. Another command can remove that path in
// between (a Stop hook letting .rcf/feedback/store.lock go). A preload
// never replaces the result of a call, so it must then treat the path as
// missing and pass the product call's own outcome on, never throw an error
// of its own in its place.
//
// Each probe case forces that interleaving on every run and every host: a
// probe preload, written into the test's own temp directory and loaded
// before the preload under test (so that preload captures the probe as its
// real existsSync), removes store.lock the first time existsSync finds it,
// writes a marker and still answers true. The child takes the store lock
// through the product's withStoreLock (src/feedback/store.js) while a live
// holder (this test process) holds it. The control loads no probe: the
// hold stays, and the child waits and reports the store busy, so the probe,
// not the host, makes the difference. Every child gets an environment the
// test builds itself. Imports Node builtins only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, '..', '..');
const storeModule = pathToFileURL(join(pkg, 'src', 'feedback', 'store.js')).href;
const PRELOADS = {
  'feedback-lock-pause.mjs': join(pkg, 'test', '_helpers', 'feedback-lock-pause.mjs'),
  'feedback-break-pause.mjs': join(pkg, 'test', '_helpers', 'feedback-break-pause.mjs'),
};
const HELD = 'held the store lock\n';

// The probe: the first existsSync that finds a file named store.lock
// removes it, records the path in the marker file and still answers true,
// which is the moment another command lets the lock go between a caller's
// existsSync and its next call on the same path.
const PROBE = `import fs from 'node:fs';
import { basename } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';

const realExists = fs.existsSync;
const realUnlink = fs.unlinkSync;
const realWrite = fs.writeFileSync;
const mark = process.env.NORM_RACE_PROBE_MARK;
let fired = false;
fs.existsSync = function probedExistsSync(p) {
  const out = realExists(p);
  if (!fired && out === true && basename(String(p)) === 'store.lock') {
    fired = true;
    realUnlink(p);
    realWrite(mark, String(p));
  }
  return out;
};
syncBuiltinESMExports();
`;

// The child: take the store lock of <root> through the product, print that
// it held it, release it.
const CHILD = `const [storeModule, root] = process.argv.slice(2);
const { withStoreLock } = await import(storeModule);
try {
  await withStoreLock(root, async () => { process.stdout.write(${JSON.stringify(HELD)}); });
  process.exit(0);
} catch (err) {
  process.stderr.write('child: ' + (err?.code ?? '') + ' ' + (err?.message ?? String(err)) + '\\n');
  process.exit(1);
}
`;

// A temp world: a project whose store lock a live holder (this process,
// fresh times, this host) holds, a control directory for the preload, the
// probe and the child.
function world(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'rcf-norm-race-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'project');
  const ctrl = join(base, 'ctrl');
  mkdirSync(join(root, '.rcf', 'feedback'), { recursive: true });
  mkdirSync(ctrl);
  const lockPath = join(root, '.rcf', 'feedback', 'store.lock');
  const at = new Date().toISOString();
  const holder = `${JSON.stringify({ pid: process.pid, hostname: hostname(), startedAt: at, refreshedAt: at, token: '0123456789abcdef' })}\n`;
  writeFileSync(lockPath, holder);
  const probe = join(base, 'probe.mjs');
  const child = join(base, 'child.mjs');
  writeFileSync(probe, PROBE);
  writeFileSync(child, CHILD);
  return { base, root, ctrl, lockPath, holder, probe, child, mark: join(base, 'probe-fired') };
}

// Run the child with the preload under test, and the probe before it when
// probe is true.
function run(w, preload, probe) {
  const args = [];
  if (probe) args.push('--import', pathToFileURL(w.probe).href);
  args.push('--import', pathToFileURL(preload).href, w.child, storeModule, w.root);
  const env = {
    RCF_TEST_PAUSE_DIR: w.ctrl,
    RCF_TEST_PAUSE_ID: 'norm-race',
    RCF_TEST_PAUSE_MAIN: w.root,
    RCF_FEEDBACK_LOCK_WAIT_MS: '200',
    NORM_RACE_PROBE_MARK: w.mark,
  };
  if (process.env.HOME) env.HOME = process.env.HOME;
  if (process.env.TMPDIR) env.TMPDIR = process.env.TMPDIR;
  const r = spawnSync(process.execPath, args, { cwd: w.root, env, encoding: 'utf8', timeout: 30_000 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const enoentOf = (stderr) => (stderr.match(/ENOENT[^\n]*/) ?? [null])[0];

for (const [name, preload] of Object.entries(PRELOADS)) {
  test(`feedback preload norm race: ${name} passes the store lock call's own outcome on when store.lock goes between its existsSync and its realpathSync`, (t) => {
    const w = world(t);
    const r = run(w, preload, true);
    assert.equal(existsSync(w.mark), true,
      `the probe removed store.lock between the preload's existsSync and its next call (the window was exercised)\nstderr:\n${r.stderr}`);
    assert.deepEqual(
      { status: r.status, stdout: r.stdout, enoent: enoentOf(r.stderr) },
      { status: 0, stdout: HELD, enoent: null },
      `the child took the store lock once the holder's lock was gone, with no ENOENT of the preload's own\nstderr:\n${r.stderr}`,
    );
  });
}

test('feedback preload norm race: control, with no probe the hold stays and the child reports the store busy under each preload', (t) => {
  for (const [name, preload] of Object.entries(PRELOADS)) {
    const w = world(t);
    const r = run(w, preload, false);
    assert.deepEqual(
      { preload: name, status: r.status, busy: /RCF_FEEDBACK_STORE_BUSY/.test(r.stderr), enoent: enoentOf(r.stderr), probeFired: existsSync(w.mark) },
      { preload: name, status: 1, busy: true, enoent: null, probeFired: false },
      `with no probe the child waits for the live holder and reports the store busy\nstderr:\n${r.stderr}`,
    );
    assert.equal(readFileSync(w.lockPath, 'utf8'), w.holder, `${name}: the live holder's lock is left as it was`);
  }
});
