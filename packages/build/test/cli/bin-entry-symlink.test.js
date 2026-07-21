// Regression tests for BUG-001 — `bin/rcf.js` silently no-ops when invoked
// via a symlinked path. On macOS `/tmp` is a symlink to `/private/tmp` and
// `npm link` / `pnpm link` installs the bin via a shim symlink. The pre-fix
// `import.meta.url === pathToFileURL(argv[1]).href` compare failed in both
// cases and main() never ran, so the CLI exited 0 with no output.
//
// The E2E test in this file is the primary regression signal — it drives
// `node <symlink-path>/bin/rcf.js --version` and checks stdout, which fails
// pre-fix (empty stdout, exit 0) and passes post-fix (`rcf 0.0.0`).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

async function runNode(argv0Bin, args = ['--version']) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [argv0Bin, ...args], {
      encoding: 'utf8',
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

test('BUG-001: rcf --version via a symlinked bin path prints "rcf <semver>"', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rcf-bug001-e2e-'));
  try {
    const linkedRoot = join(dir, 'linked-root');
    symlinkSync(repoRoot, linkedRoot, 'dir');
    const symlinkedBin = join(linkedRoot, 'bin', 'rcf.js');
    const { code, stdout, stderr } = await runNode(symlinkedBin);
    assert.equal(code, 0, `expected exit 0 (got ${code}) stderr=${stderr}`);
    // Pre-fix: stdout was empty. Post-fix: prints the version line.
    assert.match(
      stdout,
      /^rcf \d+\.\d+\.\d+\n?$/,
      `expected "rcf <semver>" via symlinked path, got: ${JSON.stringify(stdout)}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('BUG-001: rcf --help via a symlinked bin path emits top-level help', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rcf-bug001-help-'));
  try {
    const linkedRoot = join(dir, 'linked-root');
    symlinkSync(repoRoot, linkedRoot, 'dir');
    const symlinkedBin = join(linkedRoot, 'bin', 'rcf.js');
    const { code, stdout } = await runNode(symlinkedBin, ['--help']);
    assert.equal(code, 0);
    assert.match(stdout, /Usage: rcf <command>/, `expected top-level help, got: ${JSON.stringify(stdout)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
