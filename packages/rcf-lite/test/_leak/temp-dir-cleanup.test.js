// WSD w010 pin: fails when the package test suite leaks temp
// directories into the OS temp dir.
//
// The lane host's tmpfs ran out of inodes on 2026-10-13 after about
// 60,000 `rcf-*` and `fbs-*` directories accumulated across a week of
// jobs. The root cause: every test that calls `mkdtemp` is expected
// to clean up after itself, but most of them don't. Lane jobs don't
// get a `/tmp` sweep between runs, so one leak per test file per run
// compounds.
//
// This pin runs the whole suite in a child `node --test` process
// with `TMPDIR` pointed at a fresh scratch dir we own. The pin passes
// only if the scratch dir is empty after the child exits. On a leak,
// the message names the directory basenames (prefix-first) so a
// reader can map each one back to its creating test file by grepping
// `mkdtemp(join(tmpdir(), '<prefix>'))`.
//
// The pin excludes itself via the `RCF_LEAK_PIN_SPAWNED` env guard
// so the child doesn't recurse.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const PIN_SPAWNED = process.env.RCF_LEAK_PIN_SPAWNED === '1';
const SKIP_REASON = 'child run from the pin itself (RCF_LEAK_PIN_SPAWNED set): the suite re-entered through this file would recurse';

async function runSuite({ cwd, tmp, log }) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(
      process.execPath,
      ['--test', '--test-concurrency=1', 'test/**/*.test.js'],
      {
        cwd,
        env: {
          ...process.env,
          TMPDIR: tmp,
          RCF_LEAK_PIN_SPAWNED: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const chunks = [];
    child.stdout.on('data', (b) => chunks.push(b));
    child.stderr.on('data', (b) => chunks.push(b));
    child.on('error', rejectRun);
    child.on('exit', (code, signal) => {
      log.push(Buffer.concat(chunks).toString('utf8'));
      resolveRun({ code, signal });
    });
  });
}

test(
  'test suite does not leak temp dirs into TMPDIR',
  { skip: PIN_SPAWNED ? SKIP_REASON : false, timeout: 30 * 60 * 1000 },
  async (t) => {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgRoot = resolve(here, '..', '..');

    const isolated = await mkdtemp(join(tmpdir(), 'rcf-leak-pin-root-'));
    const transcript = [];
    try {
      const before = new Set(await readdir(isolated));
      assert.equal(before.size, 0, 'pin invariant: isolated TMPDIR should start empty');

      const { code, signal } = await runSuite({ cwd: pkgRoot, tmp: isolated, log: transcript });

      const after = await readdir(isolated);
      const leaked = after.filter((e) => !before.has(e));

      // Group leaks by prefix (the fixed-length head before mkdtemp's
      // six-character random suffix) so the message points at the
      // family, not every random handle.
      const byPrefix = new Map();
      for (const name of leaked) {
        const prefix = name.length > 6 ? name.slice(0, -6) : name;
        byPrefix.set(prefix, (byPrefix.get(prefix) ?? 0) + 1);
      }
      const topFamilies = [...byPrefix.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([p, n]) => `  ${n.toString().padStart(5)}  ${p}`)
        .join('\n');

      t.diagnostic(`child exit code=${code} signal=${signal ?? 'none'}`);
      t.diagnostic(`leaked temp dir count: ${leaked.length} across ${byPrefix.size} prefixes`);
      if (topFamilies) t.diagnostic(`top prefixes (grep \`mkdtemp(join(tmpdir(), '<prefix>'\` to find the creating test):\n${topFamilies}`);

      assert.equal(
        leaked.length,
        0,
        `${leaked.length} temp dir(s) left behind under TMPDIR by the suite; top prefixes:\n${topFamilies}`,
      );
    } finally {
      // Our own pin's scratch root is ours to clean. Everything
      // under `isolated` is only test-created temp dirs (we asserted
      // the before-state was empty).
      await rm(isolated, { recursive: true, force: true });
    }
  },
);
