// Regression tests for BUG-007 through BUG-011 — error prefix / message
// classification. Each of these is a spec-visible surface that the Phase
// 4 manual test flagged as inconsistent with the spec or with itself.
//
// BUG-007 P2 spec §D15: exit 1 emits `[rcf] unexpected failure: <msg>\n<stack>`.
// BUG-008 P3       : exit 4 refusals use `[error] refused …`, not `[error] usage …`.
// BUG-009 P3       : `rcf create` (missing kind) vs `create <bogus>` emit distinct messages.
// BUG-010 P3       : `rcf create prd|tad|bs|manifest` says "singleton — use rcf init".
// BUG-011 P3       : `rcf help view` prints the inline `rcf view --help` block, not a pointer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { initProject } from '@stravica-ai/rcf-lite-core/store/init.js';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, '..', '..', 'bin', 'rcf.js');

async function runBin(cwd, args = []) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [bin, ...args], {
      cwd, encoding: 'utf8', env: { ...process.env, CI: '1' },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

async function scaffold(prefix) {
  const tmp = await mkdtemp(join(tmpdir(), `rcf-err-${prefix}-`));
  await initProject({ projectRoot: tmp, projectName: 'ErrClassTest' });
  return tmp;
}

// -----------------------------------------------------------------------
// BUG-007 — exit 1 emits [rcf] unexpected failure: <msg>\n<stack>
// -----------------------------------------------------------------------

test('BUG-007: EACCES on create exits 1 with `[rcf] unexpected failure:` + stack', async (t) => {
  const tmp = await scaffold('bug007');
  const reqDir = join(tmp, 'rcf', 'requirements');
  await chmod(reqDir, 0o500);
  t.after(async () => { try { await chmod(reqDir, 0o755); } catch { /* ignore */ } });
  const { code, stderr } = await runBin(tmp, ['create', 'req', '--parent', 'PRD-001', '--title', 'X']);
  assert.equal(code, 1, `expected exit 1, got ${code}. stderr=${stderr}`);
  assert.match(
    stderr,
    /^\[rcf\] unexpected failure: /m,
    `expected spec §D15 prefix, got: ${JSON.stringify(stderr)}`,
  );
  // Spec-mandated: even under --quiet the stack must appear.
  assert.match(stderr, /at async /, `expected a stack trace in stderr, got: ${JSON.stringify(stderr)}`);
  assert.doesNotMatch(stderr, /^\[error\] ioFailure/, 'must NOT use the [error] ioFailure prefix');
});

// -----------------------------------------------------------------------
// BUG-008 — exit 4 refusals use [error] refused …
// -----------------------------------------------------------------------

test('BUG-008: exit 4 refusal (dependents) uses `[error] refused` prefix, not `[error] usage`', async () => {
  const tmp = await scaffold('bug008');
  // Add a US under REQ-001 so `delete REQ-001` (no --cascade) refuses with dependents.
  await runBin(tmp, ['create', 'us', '--parent', 'REQ-001', '--title', 'Child']);
  const { code, stderr } = await runBin(tmp, ['delete', 'REQ-001']);
  assert.equal(code, 4, `expected exit 4, got ${code}. stderr=${stderr}`);
  assert.match(stderr, /^\[error\] refused /m,
    `expected "[error] refused …", got: ${JSON.stringify(stderr)}`);
  assert.doesNotMatch(stderr, /^\[error\] usage /m,
    'must NOT use the [error] usage prefix when the exit code is 4');
});

test('BUG-008: exit 4 refusal (cascade orphan-refuse) uses `[error] refused` prefix', async () => {
  const tmp = await scaffold('bug008b');
  // Scaffold already has AC-101-1 wired into FBS-001.acIds. Adding a US to REQ-001
  // then `delete REQ-001 --cascade` should trigger the orphan-refuse pre-plan check.
  await runBin(tmp, ['create', 'us', '--parent', 'REQ-001', '--title', 'Downstream']);
  const { code, stderr } = await runBin(tmp, ['delete', 'REQ-001', '--cascade']);
  assert.equal(code, 4);
  assert.match(stderr, /^\[error\] refused /m);
});

// -----------------------------------------------------------------------
// BUG-009 — distinct missing/unknown kind messages
// -----------------------------------------------------------------------

test('BUG-009: `rcf create` (no kind) reports "kind is required"', async () => {
  const tmp = await scaffold('bug009a');
  const { code, stderr } = await runBin(tmp, ['create']);
  assert.equal(code, 2);
  assert.match(stderr, /<kind> is required/, `got: ${JSON.stringify(stderr)}`);
});

test('BUG-009: `rcf create bogus` reports "unknown kind: bogus"', async () => {
  const tmp = await scaffold('bug009b');
  const { code, stderr } = await runBin(tmp, ['create', 'bogus']);
  assert.equal(code, 2);
  assert.match(stderr, /unknown kind: bogus/, `got: ${JSON.stringify(stderr)}`);
});

// -----------------------------------------------------------------------
// BUG-010 — root singletons → "use `rcf init`"
// -----------------------------------------------------------------------

for (const kind of ['prd', 'tad', 'bs', 'manifest']) {
  test(`BUG-010: \`rcf create ${kind}\` reports singleton hint`, async () => {
    const tmp = await scaffold(`bug010-${kind}`);
    const { code, stderr } = await runBin(tmp, ['create', kind]);
    assert.equal(code, 2);
    assert.match(
      stderr,
      new RegExp(`${kind} is a root singleton`),
      `expected singleton hint for ${kind}, got: ${JSON.stringify(stderr)}`,
    );
    assert.match(stderr, /rcf init/);
  });
}

// -----------------------------------------------------------------------
// BUG-011 — `rcf help view` prints inline help, not a pointer
// -----------------------------------------------------------------------

test('BUG-011: `rcf help view` prints the inline view help block', async () => {
  const tmp = await scaffold('bug011');
  const { code, stdout } = await runBin(tmp, ['help', 'view']);
  assert.equal(code, 0);
  assert.match(stdout, /Usage: rcf view/,
    `expected inline "Usage: rcf view" block, got: ${JSON.stringify(stdout)}`);
  // The pre-fix pointer read: `See 'rcf view --help' for view options.` — must be gone.
  assert.doesNotMatch(stdout, /^See 'rcf view --help' for view options\.$/m);
  // Match the shape of the other subcommands: at least the Options: block.
  assert.match(stdout, /Options:/);
});
