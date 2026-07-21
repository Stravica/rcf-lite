// Regression tests for BUG-004 — `rcf validate --quiet` misreports the
// error count as the shown count (3), not the true total. Before the fix
// the quiet summary read "3 errors found" regardless of tree health.
// Post-fix: the summary line always carries the true total and the
// "... N more issue(s) suppressed by --quiet" line reports the delta.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { initProject } from '../../src/store/init.js';

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

async function scaffoldBroken(errorCount) {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-validate-quiet-count-'));
  await initProject({ projectRoot: tmp, projectName: 'QuietTest' });
  // Break multiple docs' schema by removing the required `status` field.
  // Each doc contributes one validation error.
  const targets = [
    'rcf/requirements/req-001.json',
    'rcf/user-stories/us-101.json',
    'rcf/tacs/tac-001.json',
    'rcf/adrs/adr-001.json',
    'rcf/fbs/fbs-001.json',
  ];
  for (let i = 0; i < errorCount; i += 1) {
    const rel = targets[i % targets.length];
    const p = join(tmp, rel);
    const doc = JSON.parse(await readFile(p, 'utf8'));
    delete doc.status;
    await writeFile(p, JSON.stringify(doc), 'utf8');
  }
  return { tmp, errorCount };
}

test('BUG-004: rcf validate --quiet reports the TOTAL count, not the shown count', async () => {
  const { tmp, errorCount } = await scaffoldBroken(5);
  const { code, stderr } = await runBin(tmp, ['validate', '--quiet']);
  assert.equal(code, 3, `expected exit 3, got ${code}. stderr=${stderr}`);
  // The summary line must state the true total (5), not the shown-count (3).
  assert.match(
    stderr,
    new RegExp(`${errorCount} errors found`),
    `expected summary "${errorCount} errors found", got: ${stderr}`,
  );
  assert.doesNotMatch(
    stderr,
    /^\[error\] 3 errors found;/m,
    'summary must not state "3 errors found" when the true total is 5',
  );
  // The "... N more issue(s) suppressed" line reports the delta.
  assert.match(stderr, new RegExp(`${errorCount - 3} more issue\\(s\\) suppressed by --quiet`));
});

test('BUG-004: non-quiet mode continues to report the true count', async () => {
  const { tmp, errorCount } = await scaffoldBroken(5);
  const { code, stderr } = await runBin(tmp, ['validate']);
  assert.equal(code, 3);
  assert.match(stderr, new RegExp(`${errorCount} errors found`));
});
