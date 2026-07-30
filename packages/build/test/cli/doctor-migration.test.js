// AC-5.1..AC-5.3 — migration path for pre-0.6.0 repos (§7). Covers
// the composite behaviour: legacy CLAUDE.md rewrites, gitignore/knowledge/
// identity refuse-then-init flow, and a hypothetical package-upgrade
// stale-hash cycle.

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

async function runBin(cwd, args) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [bin, ...args], {
      cwd, encoding: 'utf8', env: { ...process.env, CI: '1' },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

async function buildLegacyFixture() {
  // A pre-0.6.0 fixture: legacy-marker CLAUDE.md with the pre-0.6.0
  // canonical fragment content (we approximate by using the 0.6.0
  // canonical inside legacy markers - the legacy-markers migration
  // is marker-generation-agnostic, so the specific pre-content is a
  // fixture concern rather than a spec concern).
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-doc-mig-'));
  // Full rcf/ tree via init WITHOUT the 0.6.0 hygiene layer; we then
  // rewrite CLAUDE.md into legacy markers to simulate pre-0.6.0 state.
  await runBin(tmp, ['init', '--project-name', 'MigTest', '--non-interactive']);
  const canonical = await readFile(CANONICAL_PATH, 'utf8');
  await writeFile(join(tmp, 'CLAUDE.md'),
    `# legacy repo\n\n<!-- rcf:begin -->\n${canonical.trim()}\n<!-- rcf:end -->\n`, 'utf8');
  // Simulate a pre-0.6.0 repo: no knowledge, no identity, no gitignore.
  const { rm } = await import('node:fs/promises');
  await rm(join(tmp, 'rcf', 'knowledge'), { recursive: true, force: true });
  await rm(join(tmp, 'rcf', '.identity'), { recursive: true, force: true });
  await rm(join(tmp, '.gitignore'), { force: true });
  await rm(join(tmp, 'AGENTS.md'), { force: true });
  return tmp;
}

test('AC-5.1: doctor on a pre-0.6.0 fixture reports drift on all four checks; --fix migrates what it can; init re-seeds the rest; final doctor is clean', async () => {
  const tmp = await buildLegacyFixture();
  const drift = await runBin(tmp, ['doctor']);
  assert.equal(drift.code, 3);
  assert.match(drift.stdout, /legacy-markers/);
  assert.match(drift.stdout, /missing-file|missing-block/);
  assert.match(drift.stdout, /missing-directory/);
  // --fix migrates CLAUDE.md + writes .gitignore; refuses knowledge/identity.
  const fix = await runBin(tmp, ['doctor', '--fix']);
  assert.equal(fix.code, 3, `expected code 3 because knowledge/identity refused, got: ${fix.stdout}`);
  const claude = await readFile(join(tmp, 'CLAUDE.md'), 'utf8');
  assert.match(claude, /<!-- rcf:managed:begin -->/);
  assert.equal(claude.includes('<!-- rcf:begin -->'), false, 'legacy marker gone');
  // Follow-up: rcf init re-seeds knowledge + identity.
  const init2 = await runBin(tmp, ['init', '--project-name', 'MigTest', '--non-interactive']);
  assert.equal(init2.code, 0, init2.stderr);
  const clean = await runBin(tmp, ['doctor']);
  assert.equal(clean.code, 0, clean.stdout);
});

test('AC-5.3: stale-hash cycle: simulate a package upgrade by tampering the block and asserting --fix rewrites without touching operator content', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-doc-stale-'));
  await runBin(tmp, ['init', '--project-name', 'StaleTest', '--non-interactive']);
  const original = await readFile(join(tmp, 'CLAUDE.md'), 'utf8');
  const augmented = `# Operator preamble\n\n${original}\n\n## Operator trailer\n\nAfter block.\n`;
  await writeFile(join(tmp, 'CLAUDE.md'), augmented, 'utf8');
  // Simulate upgrade: tamper the block so hash no longer matches.
  const withDrift = augmented.replace('### RULE 10:', '### RULE X-legacy-name:');
  await writeFile(join(tmp, 'CLAUDE.md'), withDrift, 'utf8');
  const doctor = await runBin(tmp, ['doctor', '--check', 'agent-instructions']);
  assert.equal(doctor.code, 3);
  assert.match(doctor.stdout, /stale-hash/);
  const fix = await runBin(tmp, ['doctor', '--fix', '--check', 'agent-instructions']);
  assert.equal(fix.code, 0);
  const after = await readFile(join(tmp, 'CLAUDE.md'), 'utf8');
  assert.equal(after.startsWith('# Operator preamble\n\n'), true, 'preamble preserved');
  assert.match(after, /## Operator trailer\n\nAfter block\./);
  assert.match(after, /### RULE 10: Read the operator profile/);
});
