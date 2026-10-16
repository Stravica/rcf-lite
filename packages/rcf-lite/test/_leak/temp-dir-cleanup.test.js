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

import {
  parseExecutedTests,
  assessPinChildRun,
  EXECUTED_TESTS_FLOOR,
} from './pin-core.js';

const PIN_SPAWNED = process.env.RCF_LEAK_PIN_SPAWNED === '1';
const SKIP_REASON = 'child run from the pin itself (RCF_LEAK_PIN_SPAWNED set): the suite re-entered through this file would recurse';

async function runSuite({ cwd, tmp, log }) {
  // The pin itself runs under `node --test`, which exports
  // NODE_TEST_CONTEXT / NODE_TEST_WORKER_ID into our environment and
  // makes any inner `node --test` emit "run() is being called
  // recursively within a test file. skipping running files." and
  // exit without discovering anything. Strip those vars so the child
  // runs the suite normally.
  const childEnv = { ...process.env, TMPDIR: tmp, RCF_LEAK_PIN_SPAWNED: '1' };
  delete childEnv.NODE_TEST_CONTEXT;
  delete childEnv.NODE_TEST_WORKER_ID;

  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(
      process.execPath,
      // Pin the child to the TAP reporter: Node 24 defaults to
      // spec on both TTY and non-TTY output, which breaks the
      // summary parse (`# tests <N>` vs `ℹ tests <N>`). TAP is the
      // stable, scripted contract for scraping the executed-test
      // count.
      [
        '--test',
        '--test-reporter=tap',
        '--test-concurrency=1',
        'test/**/*.test.js',
      ],
      {
        cwd,
        env: childEnv,
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
      // `node-compile-cache` is a fixed-name cache directory that
      // npm v11 writes under TMPDIR when it is spawned as a child
      // process (via `module.enableCompileCache()`). Several of our
      // tests shell out to `npm` / `npx`, so this directory shows up
      // in the isolated TMPDIR. It is cache behaviour from the
      // toolchain, not a product `mkdtemp` leak: it has no random
      // suffix, is explicitly reused across runs, and is owned by
      // the npm process we invoked, not by any test we ship. The pin
      // only cares about `mkdtemp(join(tmpdir(), '<prefix>'))` leaks,
      // so this exact-name entry is excluded from the leak set.
      const KNOWN_TOOLCHAIN_CACHES = new Set(['node-compile-cache']);
      const leaked = after
        .filter((e) => !before.has(e))
        .filter((e) => !KNOWN_TOOLCHAIN_CACHES.has(e));

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
      t.diagnostic(`child cwd=${pkgRoot}`);
      t.diagnostic(`child TMPDIR=${isolated}`);
      // Child transcript summary: the suite's own ok/fail lines are
      // noisy; echo only the trailing per-run summary (last ~500B)
      // so the pin's own transcript still shows the child ran.
      const childTail = (transcript[0] ?? '').slice(-800);
      t.diagnostic(`child transcript tail:\n${childTail}`);
      t.diagnostic(`leaked temp dir count: ${leaked.length} across ${byPrefix.size} prefixes`);
      if (topFamilies) t.diagnostic(`top prefixes (grep \`mkdtemp(join(tmpdir(), '<prefix>'\` to find the creating test):\n${topFamilies}`);

      // Finding 3: refuse a vacuous pin. We must have seen a clean
      // child exit AND the TAP summary must report at least the
      // vacuous-run floor of tests, or the leak snapshot is not
      // trustworthy (an early-exit or discovery-failure child would
      // leave TMPDIR empty regardless of whether the suite leaks).
      const executedTests = parseExecutedTests(transcript[0] ?? '');
      t.diagnostic(
        `child executed tests parsed from TAP summary: ${executedTests ?? 'null (no summary line seen)'}`,
      );
      assessPinChildRun({
        code,
        signal,
        executedTests,
        floor: EXECUTED_TESTS_FLOOR,
      });

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
