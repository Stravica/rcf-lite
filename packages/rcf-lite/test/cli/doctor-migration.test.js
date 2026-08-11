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
// Pre-0.6.0 canonical fragment as shipped in build-v0.4.0 (§7.3 whitelist
// source entry #1). Fixture derives the exact bytes from the build-v0.4.0
// tag's `packages/build/guidance/harness-template.md` first ```markdown
// fence, `.trim()`-normalised — matching the pre-0.6.0 `loadHarnessFragment`
// contract. Hash: 3bc3c657...528f85 (see guidance/managed/legacy-fragment-hashes.json).
const LEGACY_CANONICAL_PATH = resolve(
  PACKAGE_ROOT, 'test', 'fixtures', 'legacy-fragments', 'pre-0.6.0-canonical-fragment.md',
);

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
  // A pre-0.6.0 fixture that exercises the whitelist-clean migration
  // path: legacy-marker CLAUDE.md whose inner content IS the pre-0.6.0
  // canonical fragment (byte-for-byte the 0.4.0 shipped fragment). Its
  // hash sits in `guidance/managed/legacy-fragment-hashes.json`, so
  // `detectLegacyHandEdits` returns false and --fix migrates without
  // requiring --force even in non-interactive mode.
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-doc-mig-'));
  // Full rcf/ tree via init WITHOUT the 0.6.0 hygiene layer; we then
  // rewrite CLAUDE.md into legacy markers to simulate pre-0.6.0 state.
  await runBin(tmp, ['init', '--project-name', 'MigTest', '--non-interactive']);
  const legacyFragment = await readFile(LEGACY_CANONICAL_PATH, 'utf8');
  await writeFile(join(tmp, 'CLAUDE.md'),
    `# legacy repo\n\n<!-- rcf:begin -->\n${legacyFragment.trim()}\n<!-- rcf:end -->\n`, 'utf8');
  // Simulate a pre-0.6.0 repo: no knowledge, no identity, no gitignore.
  const { rm } = await import('node:fs/promises');
  await rm(join(tmp, 'rcf', 'knowledge'), { recursive: true, force: true });
  await rm(join(tmp, 'rcf', '.identity'), { recursive: true, force: true });
  await rm(join(tmp, '.gitignore'), { force: true });
  await rm(join(tmp, 'AGENTS.md'), { force: true });
  return tmp;
}

async function buildLegacyHandEditedFixture() {
  // Fixture for AC-5.2 non-TTY refusal: legacy-marker CLAUDE.md whose
  // inner content is the pre-0.6.0 canonical fragment PLUS three
  // operator-added rules. The resulting inner hash is NOT in the
  // whitelist, so `detectLegacyHandEdits` returns true; in the
  // non-TTY branch this must refuse --fix without --force.
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-doc-handedit-'));
  await runBin(tmp, ['init', '--project-name', 'HandEditTest', '--non-interactive']);
  const legacyFragment = (await readFile(LEGACY_CANONICAL_PATH, 'utf8')).trim();
  const handEdited = `${legacyFragment}\n\n## Team notes\n- Ship on Fridays only.\n- Ask Baz before touching migrations.\n- Never bypass RCF, ever.`;
  await writeFile(join(tmp, 'CLAUDE.md'),
    `# legacy repo\n\n<!-- rcf:begin -->\n${handEdited}\n<!-- rcf:end -->\n`, 'utf8');
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

test('AC-5.2 (non-TTY branch): --fix refuses hand-edited legacy without --force, proceeds with --force', async () => {
  // Fixture: legacy CLAUDE.md whose inner content diverges from the
  // pre-0.6.0 whitelist (canonical fragment + hand-added operator
  // rules). `detectLegacyHandEdits` returns true; `stdout.isTTY` is
  // undefined under `execFile`, so the non-TTY branch fires and --fix
  // must REFUSE without --force. This is the fail-safe half of §7.3;
  // the TTY-proceeds fixture (which needs a pseudo-TTY) is a v0.6.1
  // follow-up.
  const tmp = await buildLegacyHandEditedFixture();
  const before = await readFile(join(tmp, 'CLAUDE.md'), 'utf8');
  assert.match(before, /Ship on Fridays only\./, 'fixture carries hand-added rules');

  // Refusal path: --fix (no --force) reports legacy-markers-hand-edited
  // and leaves the file untouched.
  const refuse = await runBin(tmp, ['doctor', '--fix', '--check', 'agent-instructions']);
  assert.equal(refuse.code, 3, `expected refusal exit 3, got: ${refuse.stdout}`);
  assert.match(refuse.stdout, /legacy-markers-hand-edited/,
    'drift item names the hand-edited refusal state');
  const untouched = await readFile(join(tmp, 'CLAUDE.md'), 'utf8');
  assert.equal(untouched, before, 'CLAUDE.md is byte-identical after refused --fix');
  assert.match(untouched, /<!-- rcf:begin -->/, 'legacy begin marker still present');
  assert.match(untouched, /Ship on Fridays only\./, 'hand edits preserved on refusal');

  // Acceptance path: --fix --force overwrites the legacy block with the
  // new managed block; the operator's hand-added rules inside the
  // markers ARE now lost (that is the explicit `--force` contract).
  const forceRun = await runBin(tmp, ['doctor', '--fix', '--force', '--check', 'agent-instructions']);
  assert.equal(forceRun.code, 0, `expected --force to succeed, got: ${forceRun.stdout}`);
  const after = await readFile(join(tmp, 'CLAUDE.md'), 'utf8');
  assert.match(after, /<!-- rcf:managed:begin -->/, 'new managed markers landed');
  assert.equal(after.includes('<!-- rcf:begin -->'), false, 'legacy markers gone');
  assert.equal(after.includes('Ship on Fridays only.'), false,
    'hand edits inside legacy markers overwritten under --force (spec §7.3 acceptance)');
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
