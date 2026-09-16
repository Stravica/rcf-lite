// AC-16201-2 (US-16201, REQ-162, FBS-185): rcf init writes CLAUDE.md
// and AGENTS.md with the regenerated block, and RULE 17 lands between
// the managed markers on both files. No new init flag: the existing
// writeAgentInstructions path is the only touch-point.
//
// Companion assertion for the existing-project upgrade path: a project
// already initialised on the pre-slice block (the block minus RULE 17)
// reports stale-hash on `rcf doctor` and picks up RULE 17 on
// `rcf doctor --fix`, without --force in non-interactive mode. This
// proves that adding a rule does not break existing projects' doctor
// runs (spec section 3.4 invariant, and the design ships the change
// without a legacy-fragment-hashes bump because the managed-markers
// stale-hash path handles the upgrade in place).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, '..', '..', 'bin', 'rcf.js');
const PACKAGE_ROOT = resolve(here, '..', '..');
const CANONICAL_PATH = resolve(PACKAGE_ROOT, 'guidance', 'managed', 'agent-instructions-block.md');
const FIXTURE_PATH = resolve(PACKAGE_ROOT, 'test', 'fixtures', 'managed', 'rule-17.md');

const MANAGED_BEGIN = '<!-- rcf:managed:begin -->';
const MANAGED_END = '<!-- rcf:managed:end -->';

async function runBin(cwd, args, env = {}) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [bin, ...args], {
      cwd, encoding: 'utf8', env: { ...process.env, CI: '1', ...env },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

async function freshInit(prefix = 'rcf-r17-init-') {
  const tmp = await mkdtemp(join(tmpdir(), prefix));
  const { code, stderr } = await runBin(tmp, ['init', '--project-name', 'Rule17Test', '--non-interactive']);
  assert.equal(code, 0, stderr);
  return tmp;
}

function extractManagedInner(fileText) {
  const startIdx = fileText.indexOf(MANAGED_BEGIN);
  const endIdx = fileText.indexOf(MANAGED_END);
  if (startIdx < 0 || endIdx < 0) throw new Error('managed markers missing');
  return fileText.slice(startIdx + MANAGED_BEGIN.length, endIdx);
}

test('AC-16201-2: rcf init writes RULE 17 into CLAUDE.md and AGENTS.md between the managed markers', async () => {
  const tmp = await freshInit();
  const fixture = await readFile(FIXTURE_PATH, 'utf8');
  const rule17Header = '### RULE 17: Log what misbehaves; ask once before anything leaves.';
  for (const name of ['CLAUDE.md', 'AGENTS.md']) {
    const text = await readFile(join(tmp, name), 'utf8');
    const inner = extractManagedInner(text);
    assert.ok(inner.includes(rule17Header), `${name} managed block missing RULE 17 header`);
    // The fixture (byte-exact RULE 17 slice) sits inside the managed inner.
    assert.ok(inner.includes(fixture.trimEnd()), `${name} managed block does not carry the RULE 17 fixture verbatim`);
  }
});

test('AC-16201-2: an existing project on the pre-slice block reports stale-hash and picks up RULE 17 on doctor --fix', async () => {
  const tmp = await freshInit();
  const canonical = await readFile(CANONICAL_PATH, 'utf8');
  const fixture = await readFile(FIXTURE_PATH, 'utf8');
  // Synthesise the pre-slice canonical: strip RULE 17 and the blank
  // line that follows it, restoring the block that shipped before this
  // slice. That is the content an existing project's managed block
  // carries after the previous release's init or doctor --fix.
  const preSlice = canonical.replace(`${fixture.trimEnd()}\n\n`, '');
  assert.notEqual(preSlice, canonical, 'stripping RULE 17 changed nothing (fixture drift?)');
  assert.equal(preSlice.includes('### RULE 17:'), false, 'pre-slice block still carries RULE 17');
  // Overwrite both CLAUDE.md and AGENTS.md with the pre-slice managed
  // block between the same markers, simulating a project upgraded from
  // a prior version.
  for (const name of ['CLAUDE.md', 'AGENTS.md']) {
    const path = join(tmp, name);
    const text = await readFile(path, 'utf8');
    const begin = text.indexOf(MANAGED_BEGIN);
    const end = text.indexOf(MANAGED_END);
    const rewritten = `${text.slice(0, begin + MANAGED_BEGIN.length)}\n${preSlice.trim()}\n${text.slice(end)}`;
    await writeFile(path, rewritten, 'utf8');
  }
  // Doctor sees stale-hash on both files.
  const drift = await runBin(tmp, ['doctor', '--check', 'agent-instructions']);
  assert.equal(drift.code, 3, drift.stdout);
  assert.match(drift.stdout, /stale-hash/);
  assert.match(drift.stdout, /CLAUDE\.md/);
  assert.match(drift.stdout, /AGENTS\.md/);
  // --fix repairs both without --force (managed-markers path, not the
  // hand-edited-legacy path).
  const fix = await runBin(tmp, ['doctor', '--fix', '--check', 'agent-instructions']);
  assert.equal(fix.code, 0, fix.stdout);
  // Both files now carry RULE 17 between the markers.
  for (const name of ['CLAUDE.md', 'AGENTS.md']) {
    const text = await readFile(join(tmp, name), 'utf8');
    const inner = extractManagedInner(text);
    assert.ok(inner.includes('### RULE 17:'), `${name} did not pick up RULE 17 on --fix`);
    assert.ok(inner.includes(fixture.trimEnd()), `${name} RULE 17 slice not byte-identical after --fix`);
  }
  // Doctor is clean on the follow-up run.
  const clean = await runBin(tmp, ['doctor', '--check', 'agent-instructions']);
  assert.equal(clean.code, 0, clean.stdout);
});
